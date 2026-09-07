// Binder — deck operations. Pure reducers, nothing mutates its input.
//
// Adding a card routes by TYPE rather than asking the user where it goes: a
// legend is the deck's legend, battlefields and runes have their own zones, and
// everything else is main deck. The user says "add three" and the deck sorts
// itself out.
//
// Deliberately no rules enforcement here — no size limits, no copy limits.
// BINDER.md § Hard IP constraints forbids automated rules enforcement for
// gameplay, and deckbuilding legality belongs in validate() against Rules.ts,
// where it is reported as violations rather than silently prevented.

import type { Card, Deck } from './Types';
import { COLOURLESS_DOMAIN } from './Rules';

export function emptyDeck(id: string, name: string, now: number): Deck {
  return {
    id, name, legendId: null, chosenChampionId: null,
    main: [], runes: [], battlefieldIds: [], sideboard: [], updatedAt: now,
  };
}

/**
 * Does this card's identity fit inside the legend's?
 *
 * Core rules 103.1.b.1: a card must abide by the deck's Domain Identity, and a
 * dual-domain card needs BOTH of its domains inside it — not merely one. That
 * distinction matters: "shares any domain" wrongly admits a Fury/Chaos card
 * into a Fury/Order deck.
 */
export function fitsDomainIdentity(card: Card, legend: Card | null): boolean {
  if (legend === null) return true;                 // nothing to check against yet
  if (card.domains.length === 0) return true;
  const identity = legend.domains.map((d) => d.trim().toLowerCase());
  return card.domains.every((domain) => {
    const d = domain.trim().toLowerCase();
    return d === COLOURLESS_DOMAIN || identity.indexOf(d) !== -1;
  });
}

function bump(deck: Deck, now: number): Deck {
  return { ...deck, updatedAt: now };
}

function addSlot(
  slots: readonly { cardId: string; count: number }[],
  cardId: string,
  by: number,
): { cardId: string; count: number }[] {
  const index = slots.findIndex((s) => s.cardId === cardId);
  if (index === -1) return slots.concat([{ cardId, count: by }]);
  const next = slots.slice();
  next[index] = { cardId, count: next[index].count + by };
  return next;
}

function removeSlot(
  slots: readonly { cardId: string; count: number }[],
  cardId: string,
  by: number,
): { cardId: string; count: number }[] {
  const index = slots.findIndex((s) => s.cardId === cardId);
  if (index === -1) return slots.slice();
  const next = slots.slice();
  const remaining = next[index].count - by;
  if (remaining <= 0) next.splice(index, 1);
  else next[index] = { cardId, count: remaining };
  return next;
}

/** Route by card type. A second legend replaces the first — there is only one. */
export function addToDeck(deck: Deck, card: Card, count: number, now: number): Deck {
  if (count <= 0) return deck;
  switch (card.type) {
    case 'legend':
      // Changing legend changes the deck's identity, so a Chosen Champion
      // picked for the old legend no longer matches and is cleared.
      return bump({
        ...deck,
        legendId: card.id,
        chosenChampionId: deck.legendId === card.id ? deck.chosenChampionId : null,
      }, now);
    case 'battlefield': {
      if (deck.battlefieldIds.indexOf(card.id) !== -1) return deck;
      return bump({ ...deck, battlefieldIds: deck.battlefieldIds.concat([card.id]) }, now);
    }
    case 'rune':
      return bump({ ...deck, runes: addSlot(deck.runes, card.id, count) }, now);
    default:
      return bump({ ...deck, main: addSlot(deck.main, card.id, count) }, now);
  }
}

export function removeFromDeck(deck: Deck, card: Card, count: number, now: number): Deck {
  if (count <= 0) return deck;
  switch (card.type) {
    case 'legend':
      return deck.legendId === card.id
        ? bump({ ...deck, legendId: null, chosenChampionId: null }, now)
        : deck;
    case 'battlefield': {
      const index = deck.battlefieldIds.indexOf(card.id);
      if (index === -1) return deck;
      const next = deck.battlefieldIds.slice();
      next.splice(index, 1);
      return bump({ ...deck, battlefieldIds: next }, now);
    }
    case 'rune':
      return bump({ ...deck, runes: removeSlot(deck.runes, card.id, count) }, now);
    default:
      return bump({ ...deck, main: removeSlot(deck.main, card.id, count) }, now);
  }
}

/**
 * Nominate the Chosen Champion. It lives in the Champion Zone rather than the
 * main deck, but still counts toward the 40 (103.2.a.2), so it is stored
 * separately and added to the count rather than pushed into `main`.
 */
export function setChosenChampion(deck: Deck, card: Card | null, now: number): Deck {
  const id = card === null ? null : card.id;
  if (deck.chosenChampionId === id) return deck;
  return bump({ ...deck, chosenChampionId: id }, now);
}

/** Champion tags a card carries, lower-cased. */
export function championTags(card: Card): string[] {
  return card.tags.map((t) => t.trim().toLowerCase()).filter((t) => t !== '');
}

/** Does this card carry any of the legend's champion tags? Any card type. */
export function sharesChampionTag(card: Card, legend: Card | null): boolean {
  if (legend === null) return false;
  const legendTags = championTags(legend);
  return championTags(card).some((tag) => legendTags.indexOf(tag) !== -1);
}

/** Does this unit's champion tag match the legend's, per 103.2.a.2? */
export function matchesLegendChampion(card: Card, legend: Card | null): boolean {
  if (card.type !== 'unit') return false;
  return sharesChampionTag(card, legend);
}

/**
 * Is this a signature card, per 103.2.d?
 *
 * The catalogue carries this as the supertype 'Signature' — 61 Spell/Unit/Gear
 * cards, each tagged with the champion they belong to. Do NOT confuse it with
 * Riftcodex's `metadata.signature`, which marks the '229*' collector printing
 * of a LEGEND: the two sets do not overlap at all, and only this one is a
 * gameplay class.
 */
export function isSignatureCard(card: Card): boolean {
  return card.supertype !== null && card.supertype.trim().toLowerCase() === 'signature';
}

/**
 * Signature cards held in the deck, with their copy counts.
 *
 * The Chosen Champion is counted: it counts toward the 40 (103.2.a.2), and
 * signature UNITS carrying a champion tag do exist, so nominating one is
 * reachable rather than theoretical.
 *
 * The sideboard is NOT counted. 103.2.d limits the deck as registered, and the
 * rules text checked does not say the limit is re-measured after a swap.
 */
export function signatureCards(
  deck: Deck, byId: (cardId: string) => Card | null,
): { card: Card; count: number }[] {
  const out: { card: Card; count: number }[] = [];
  for (const slot of deck.main) {
    const card = byId(slot.cardId);
    if (card !== null && isSignatureCard(card)) out.push({ card, count: slot.count });
  }
  if (deck.chosenChampionId !== null) {
    const champion = byId(deck.chosenChampionId);
    if (champion !== null && isSignatureCard(champion)) out.push({ card: champion, count: 1 });
  }
  return out;
}

/**
 * How many copies of this card the deck can hold right now.
 *
 * Singletons — the legend, the Chosen Champion, a battlefield — are 1. Runes
 * are capped by what the rune deck still needs, because a two-domain deck wants
 * six of each and a 3-copy cap would make a legal rune deck impossible.
 * Everything else is the main-deck limit of 3 (103.2.b).
 */
export function maxCopiesFor(
  card: Card, deck: Deck, byId: (cardId: string) => Card | null,
  runesRequired = 12, mainCopyLimit = 3,
): number {
  if (card.type === 'legend' || card.type === 'battlefield') return 1;

  const legend = deck.legendId === null ? null : byId(deck.legendId);
  if (deck.chosenChampionId === null && matchesLegendChampion(card, legend)) return 1;
  if (card.id === deck.chosenChampionId) return 1;

  if (card.type === 'rune') {
    const others = deck.runes
      .filter((s) => s.cardId !== card.id)
      .reduce((sum, s) => sum + s.count, 0);
    return Math.max(1, runesRequired - others);
  }
  return mainCopyLimit;
}

/**
 * One gesture, all the counts. Each pinch adds a copy; pinching at the maximum
 * wraps back to none.
 *
 * A plain toggle could not build a rune deck at all — twelve runes drawn from
 * about thirty cards means six copies of one card, and toggling caps every card
 * at one. Cycling keeps a single gesture while letting counts climb.
 */
export function cycleCard(
  deck: Deck, card: Card, byId: (cardId: string) => Card | null, now: number,
  runesRequired = 12, mainCopyLimit = 3,
): Deck {
  const max = maxCopiesFor(card, deck, byId, runesRequired, mainCopyLimit);
  const current = deckCount(deck, card.id);

  if (current >= max) {
    // Wrap to zero: remove every copy, whatever the count.
    let next = deck;
    for (let i = 0; i < current; i++) next = removeFromDeck(next, card, 1, now);
    return next;
  }

  const legend = deck.legendId === null ? null : byId(deck.legendId);
  if (deck.chosenChampionId === null && matchesLegendChampion(card, legend)) {
    return setChosenChampion(deck, card, now);
  }
  return addToDeck(deck, card, 1, now);
}

/** Move a card between the main deck and the sideboard, either direction. */
export function toSideboard(deck: Deck, card: Card, now: number): Deck {
  const inMain = deck.main.find((s) => s.cardId === card.id);
  if (inMain === undefined) return deck;
  const moved = removeFromDeck(deck, card, 1, now);
  return bump({ ...moved, sideboard: addSlot(moved.sideboard, card.id, 1) }, now);
}

export function fromSideboard(deck: Deck, card: Card, now: number): Deck {
  const held = deck.sideboard.find((s) => s.cardId === card.id);
  if (held === undefined) return deck;
  const next = { ...deck, sideboard: removeSlot(deck.sideboard, card.id, 1) };
  return addToDeck(next, card, 1, now);
}

/**
 * Move a card between the main deck and the sideboard, whichever way it needs
 * to go. One control rather than two: a card is only ever in one of the two
 * places, so which direction is meant is never ambiguous.
 *
 * Returns the deck unchanged when the card is in neither — nothing to move.
 */
export function toggleSideboard(deck: Deck, card: Card, now: number): Deck {
  const held = deck.sideboard.find((s) => s.cardId === card.id);
  if (held !== undefined) return fromSideboard(deck, card, now);
  return toSideboard(deck, card, now);
}

export function sideboardSize(deck: Deck): number {
  return deck.sideboard.reduce((sum, s) => sum + s.count, 0);
}

/** Is this card already committed anywhere in the deck? */
export function isInDeck(deck: Deck, cardId: string): boolean {
  return deck.legendId === cardId
    || deck.chosenChampionId === cardId
    || deck.battlefieldIds.indexOf(cardId) !== -1
    || deck.main.some((s) => s.cardId === cardId)
    || deck.runes.some((s) => s.cardId === cardId)
    || deck.sideboard.some((s) => s.cardId === cardId);
}

/** Copies of one card anywhere in the deck. */
export function deckCount(deck: Deck, cardId: string): number {
  if (deck.legendId === cardId) return 1;
  if (deck.battlefieldIds.indexOf(cardId) !== -1) return 1;
  const main = deck.main.find((s) => s.cardId === cardId);
  if (main !== undefined) return main.count;
  const rune = deck.runes.find((s) => s.cardId === cardId);
  return rune === undefined ? 0 : rune.count;
}

/**
 * Main deck size for rule purposes: the cards in `main` PLUS the Chosen
 * Champion, which sits outside the deck but counts toward the 40.
 */
export function mainDeckSize(deck: Deck): number {
  const inDeck = deck.main.reduce((sum, s) => sum + s.count, 0);
  return inDeck + (deck.chosenChampionId === null ? 0 : 1);
}

export function runeDeckSize(deck: Deck): number {
  return deck.runes.reduce((sum, s) => sum + s.count, 0);
}

/**
 * Fill the rune deck to 12, balanced across the legend's domains.
 *
 * Runes are the least interesting decision in the build — they follow
 * mechanically from the legend's identity — so doing them by hand is busywork.
 * Split evenly across the legend's domains, remainder to the earlier ones.
 *
 * ASSUMPTION, not verified: no per-card copy limit on runes. The 3-copy rule
 * (103.2.b) is stated for the main deck, and a 12-rune deck across two domains
 * needs 6 of each, so a 3-copy cap there would make legal decks impossible.
 */
export function autoFillRunes(
  deck: Deck,
  cards: readonly Card[],
  byId: (cardId: string) => Card | null,
  now: number,
  required = 12,
): Deck {
  const legend = deck.legendId === null ? null : byId(deck.legendId);
  if (legend === null) return deck;

  const identity = legend.domains.filter((d) => d.trim() !== '');
  if (identity.length === 0) return deck;

  // One representative rune per domain of the identity.
  const runeFor = (domain: string): Card | null => {
    const wanted = domain.trim().toLowerCase();
    const matches = cards.filter((c) => c.type === 'rune'
      && c.domains.some((d) => d.trim().toLowerCase() === wanted));
    if (matches.length === 0) return null;
    matches.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return matches[0];
  };

  const perDomain = Math.floor(required / identity.length);
  const remainder = required - perDomain * identity.length;

  let next: Deck = { ...deck, runes: [] };
  identity.forEach((domain, i) => {
    const rune = runeFor(domain);
    if (rune === null) return;
    const count = perDomain + (i < remainder ? 1 : 0);
    if (count > 0) next = addToDeck(next, rune, count, now);
  });

  return next.runes.length === 0 ? deck : bump(next, now);
}

/** Energy curve as a sorted list, for the deck wall and for agent prompts. */
export function energyCurve(
  deck: Deck,
  byId: (cardId: string) => Card | null,
): { energy: number | null; count: number }[] {
  const counts = new Map<number, number>();
  let nullEnergy = 0;
  for (const slot of deck.main) {
    const card = byId(slot.cardId);
    const energy = card === null ? null : card.energy;
    if (energy === null) nullEnergy += slot.count;
    else counts.set(energy, (counts.get(energy) ?? 0) + slot.count);
  }
  const curve = Array.from(counts.keys()).sort((a, b) => a - b)
    .map((energy) => ({ energy: energy as number | null, count: counts.get(energy) as number }));
  if (nullEnergy > 0) curve.push({ energy: null, count: nullEnergy });
  return curve;
}
