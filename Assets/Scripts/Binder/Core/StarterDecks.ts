// RiftBinder — example decks, built from the catalogue. Pure.
//
// An empty "Your decks" shelf is a bad first look at a deckbuilder: you cannot
// tell what a saved deck is meant to contain, or whether the screen works. So
// the shelf starts with a few legal decks built from the real catalogue.
//
// These are EXAMPLES, not recommendations. Nothing here claims a deck is good,
// popular or competitive — BINDER.md rules metagame data out entirely, and a
// deck assembled by taking the first legal cards in catalogue order is in no
// sense a tier list. Names say what the deck IS, never how it performs.

import type { Card, Deck } from './Types';
import { addToDeck, setChosenChampion, autoFillRunes, fitsDomainIdentity,
         matchesLegendChampion, mainDeckSize } from './DeckOps';
import { Rules } from './Rules';

/** How many example decks to build, when the shelf is empty. */
export const STARTER_DECK_COUNT = 3;

/**
 * Build one legal deck around a legend.
 *
 * Deterministic: same catalogue in, same deck out. That matters because these
 * are seeded once and then belong to the user — a deck that changed shape
 * between runs would rewrite what they thought they had saved.
 *
 * Returns null when the legend cannot support a legal deck, which is the honest
 * outcome for a legend with too few cards inside its identity.
 */
export function buildStarterDeck(
  cards: readonly Card[], legend: Card, now: number, id: string,
): Deck | null {
  if (legend.type !== 'legend') return null;

  let deck = addToDeck(emptyNamed(id, legend, now), legend, 1, now);

  // The Chosen Champion: a champion unit sharing the legend's tag. Without one
  // the deck can never be legal, so a legend with none is not usable here.
  const champion = cards.find((c) => matchesLegendChampion(c, legend));
  if (champion === undefined) return null;
  deck = setChosenChampion(deck, champion, now);

  // Three battlefields, each a different NAME — 103.4.c is about names, not ids,
  // so picking by id alone would let two printings of one battlefield through.
  const usedNames: string[] = [];
  for (const card of cards) {
    if (deck.battlefieldIds.length >= Rules.battlefieldCount.value) break;
    if (card.type !== 'battlefield') continue;
    const name = card.name.toLowerCase();
    if (usedNames.indexOf(name) !== -1) continue;
    usedNames.push(name);
    deck = addToDeck(deck, card, 1, now);
  }

  // Runes follow the legend's domains and hold no interesting decision.
  deck = autoFillRunes(deck, cards, (cardId) => byId(cards, cardId), now,
    Rules.runeDeckSize.value);

  // Then the main deck, up to the minimum. Three copies each, because a deck of
  // forty singletons is not a deck anyone would build.
  for (const card of cards) {
    if (mainDeckSize(deck) >= Rules.mainMinimum.value) break;
    if (!isMainDeckCard(card)) continue;
    if (!fitsDomainIdentity(card, legend)) continue;
    if (card.id === champion.id) continue;

    const room = Rules.mainMinimum.value - mainDeckSize(deck);
    const copies = Math.min(Rules.maxCopies.value, room);
    if (copies > 0) deck = addToDeck(deck, card, copies, now);
  }

  return mainDeckSize(deck) >= Rules.mainMinimum.value ? deck : null;
}

/**
 * Build the example shelf.
 *
 * Walks legends in catalogue order and keeps the first `count` that can carry a
 * legal deck. Legends whose identity is too narrow are skipped rather than
 * producing a half-built deck the validator would immediately complain about.
 */
export function buildStarterDecks(
  cards: readonly Card[], now: number, count = STARTER_DECK_COUNT,
): Deck[] {
  const decks: Deck[] = [];
  const usedLegendNames: string[] = [];

  for (const legend of cards) {
    if (decks.length >= count) break;
    if (legend.type !== 'legend') continue;
    // One deck per NAMED legend: the catalogue carries several printings of the
    // same legend, and three decks around the same champion is not a shelf.
    const name = legend.name.toLowerCase();
    if (usedLegendNames.indexOf(name) !== -1) continue;

    const deck = buildStarterDeck(cards, legend, now, `starter-${decks.length + 1}`);
    if (deck === null) continue;
    usedLegendNames.push(name);
    decks.push(deck);
  }
  return decks;
}

function emptyNamed(id: string, legend: Card, now: number): Deck {
  return {
    id,
    // Says what the deck is — its legend — and nothing about how it performs.
    name: `${legend.name.split(' - ')[0]} starter`,
    legendId: null,
    chosenChampionId: null,
    main: [],
    runes: [],
    battlefieldIds: [],
    sideboard: [],
    updatedAt: now,
  };
}

function isMainDeckCard(card: Card): boolean {
  return card.type !== 'legend' && card.type !== 'battlefield' && card.type !== 'rune';
}

function byId(cards: readonly Card[], cardId: string): Card | null {
  const found = cards.find((c) => c.id === cardId);
  return found === undefined ? null : found;
}
