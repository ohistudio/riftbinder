// Binder — deck validation. Pure.
//
// Reports problems; never prevents them. BINDER.md § Hard IP constraints
// forbids automated rules enforcement, and a deckbuilder that silently refuses
// an edit is enforcing rather than informing. Everything here is advisory.
//
// Rules verified 2026-09-01 — see Rules.ts for sources and rule numbers. A
// verified rule produces an ERROR; anything still unverified produces a WARNING
// that says so on its face.

import type { Card, CardSource, Deck, Violation } from './Types.ts';
import type { RuleSpec } from './Rules.ts';
import { Rules } from './Rules.ts';
import { mainDeckSize, runeDeckSize, sideboardSize, fitsDomainIdentity, matchesLegendChampion,
         signatureCards, sharesChampionTag } from './DeckOps.ts';

function violation(rule: RuleSpec, message: string): Violation {
  return {
    rule: rule.id,
    message: rule.verified ? message : `${message} (unverified — ${rule.note})`,
    severity: rule.verified ? 'error' : 'warning',
  };
}

function error(rule: string, message: string): Violation {
  return { rule, message, severity: 'error' };
}

/** Structural checks that hold regardless of format. */
function structural(deck: Deck, source: CardSource): Violation[] {
  const out: Violation[] = [];

  for (const slot of deck.main.concat(deck.runes).concat(deck.sideboard)) {
    if (slot.count <= 0) {
      out.push(error('slot.nonPositive', `${slot.cardId} has a count of ${slot.count}.`));
    }
    if (source.byId(slot.cardId) === null) {
      out.push(error('card.unknown', `${slot.cardId} is not in the card data.`));
    }
  }

  const wrongZone = (
    slot: { cardId: string }, allowed: (c: Card) => boolean, zone: string,
  ): void => {
    const card = source.byId(slot.cardId);
    if (card !== null && !allowed(card)) {
      out.push(error('zone.mismatch', `${card.name} is a ${card.type} but sits in the ${zone}.`));
    }
  };
  for (const slot of deck.main) {
    wrongZone(slot, (c) => c.type !== 'rune' && c.type !== 'legend' && c.type !== 'battlefield', 'main deck');
  }
  for (const slot of deck.runes) wrongZone(slot, (c) => c.type === 'rune', 'rune deck');

  return out;
}

/** The legend, and the Chosen Champion that must match it. Rules 103.1, 103.2.a. */
function championship(deck: Deck, source: CardSource): Violation[] {
  const out: Violation[] = [];

  const legend = deck.legendId === null ? null : source.byId(deck.legendId);
  if (deck.legendId === null) {
    out.push(error('legend.required',
      'No Champion Legend chosen. The legend is picked first — it sets the deck\'s domain identity.'));
    return out;   // everything below is measured against the legend
  }
  if (legend === null) {
    out.push(error('legend.unknown', `Legend ${deck.legendId} is not in the card data.`));
    return out;
  }
  if (legend.type !== 'legend') {
    out.push(error('legend.wrongType', `${legend.name} is a ${legend.type}, not a legend.`));
  }

  if (deck.chosenChampionId === null) {
    out.push(error('champion.required',
      'No Chosen Champion. It must be a champion unit whose tag matches the legend, '
      + 'and it counts toward the 40.'));
  } else {
    const champion = source.byId(deck.chosenChampionId);
    if (champion === null) {
      out.push(error('champion.unknown', `${deck.chosenChampionId} is not in the card data.`));
    } else if (!matchesLegendChampion(champion, legend)) {
      out.push(error('champion.tagMismatch',
        `${champion.name} does not share a champion tag with ${legend.name}.`));
    }
  }

  return out;
}

/** Domain identity, rule 103.1.b.1 — applies to main deck AND rune deck. */
function domainIdentity(deck: Deck, source: CardSource): Violation[] {
  const legend = deck.legendId === null ? null : source.byId(deck.legendId);
  if (legend === null) return [];

  const out: Violation[] = [];
  // Sideboard cards enter play, so they obey the identity too.
  for (const slot of deck.main.concat(deck.runes).concat(deck.sideboard)) {
    const card = source.byId(slot.cardId);
    if (card === null || fitsDomainIdentity(card, legend)) continue;
    out.push(error('deck.domainIdentity',
      `${card.name} (${card.domains.join('/')}) is outside ${legend.name}'s identity `
      + `(${legend.domains.join('/')}). A dual-domain card needs BOTH domains inside it.`));
  }
  return out;
}

export function validate(deck: Deck, source: CardSource): Violation[] {
  const out: Violation[] = structural(deck, source)
    .concat(championship(deck, source))
    .concat(domainIdentity(deck, source));

  const main = mainDeckSize(deck);
  if (main < Rules.mainMinimum.value) {
    out.push(violation(Rules.mainMinimum,
      `Main deck has ${main} cards; at least ${Rules.mainMinimum.value} required `
      + '(the Chosen Champion counts toward it).'));
  } else if (main !== Rules.mainExactForSanctioned.value) {
    out.push(violation(Rules.mainExactForSanctioned,
      `Main deck has ${main} cards; sanctioned play registers exactly `
      + `${Rules.mainExactForSanctioned.value}.`));
  }

  for (const slot of deck.main) {
    if (slot.count > Rules.maxCopies.value) {
      const card = source.byId(slot.cardId);
      out.push(violation(Rules.maxCopies,
        `${card === null ? slot.cardId : card.name} appears ${slot.count} times; `
        + `limit ${Rules.maxCopies.value}.`));
    }
  }

  const runes = runeDeckSize(deck);
  if (runes !== Rules.runeDeckSize.value) {
    out.push(violation(Rules.runeDeckSize,
      `Rune deck has ${runes} cards; ${Rules.runeDeckSize.value} required.`));
  }

  // Uniqueness is a verified rule (103.4.c); the COUNT depends on the mode.
  const seenBattlefields: string[] = [];
  for (const id of deck.battlefieldIds) {
    const card = source.byId(id);
    const name = card === null ? id : card.name;
    if (seenBattlefields.indexOf(name.toLowerCase()) !== -1) {
      out.push(error('battlefields.duplicateName',
        `Two battlefields named ${name}; each must have a unique name.`));
    } else {
      seenBattlefields.push(name.toLowerCase());
    }
  }
  if (deck.battlefieldIds.length !== Rules.battlefieldCount.value) {
    out.push(violation(Rules.battlefieldCount,
      `${deck.battlefieldIds.length} battlefields chosen; ${Rules.battlefieldCount.value} expected.`));
  }

  const side = sideboardSize(deck);
  if (side !== 0 && side !== Rules.sideboardSize.value) {
    out.push(violation(Rules.sideboardSize,
      `Sideboard has ${side} cards; it must be exactly ${Rules.sideboardSize.value} or empty.`));
  }

  // Signature cards, 103.2.d. See isSignatureCard() for why this reads the
  // 'Signature' SUPERTYPE and not Riftcodex's metadata.signature flag.
  const legendCard = deck.legendId === null ? null : source.byId(deck.legendId);
  if (legendCard !== null) {
    const signatures = signatureCards(deck, (id) => source.byId(id));
    const total = signatures.reduce((sum, s) => sum + s.count, 0);
    if (total > Rules.maxSignatureCards.value) {
      out.push(violation(Rules.maxSignatureCards,
        `${total} signature cards in the deck; limit ${Rules.maxSignatureCards.value}.`));
    }
    for (const s of signatures) {
      if (sharesChampionTag(s.card, legendCard)) continue;
      const belongsTo = s.card.tags.length === 0 ? 'another champion' : s.card.tags.join('/');
      out.push(violation(Rules.signatureTagMatch,
        `${s.card.name} is a signature card for ${belongsTo}, not ${legendCard.name}.`));
    }
  }

  return out;
}

export function errorCount(violations: readonly Violation[]): number {
  return violations.filter((v) => v.severity === 'error').length;
}
