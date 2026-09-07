// Binder — what you are allowed to pick right now. Pure.
//
// The catalogue is 1451 cards, but at any moment only a slice is a legal
// choice: legends before a legend exists, matching champion units before a
// Chosen Champion exists, then cards inside the legend's domain identity.
//
// This is shared with the agent ON PURPOSE. `selectCandidates` narrows this
// same pool, so what the agent offers and what you can browse can never drift
// apart — an agent suggesting a card the wall would not let you pick, or the
// reverse, is a bug waiting to happen.
//
// Legends are picked LOCALLY from this pool rather than through the model.
// There are only ~180 of them, choosing one is a browse-and-decide task rather
// than a question, and a round trip to an LLM to look at a list you already
// hold is slower and worse.

import type { Card, Deck } from './Types';
import { fitsDomainIdentity, matchesLegendChampion } from './DeckOps';

export type BuildStage = 'legend' | 'champion' | 'battlefields' | 'runes' | 'deck';

/** How many battlefields and runes a finished deck needs. */
export const BATTLEFIELDS_REQUIRED = 3;
export const RUNES_REQUIRED = 12;

/**
 * Where you are in the build. Only the first two stages are true gates — a
 * legend fixes the domain identity and the champion must match it, so nothing
 * else is answerable until they exist. Battlefields and runes come next because
 * they are quick, constrained decisions, and getting them out of the way leaves
 * the open-ended 40-card choice for last.
 */
export function stageOf(deck: Deck): BuildStage {
  if (deck.legendId === null) return 'legend';
  if (deck.chosenChampionId === null) return 'champion';
  if (deck.battlefieldIds.length < BATTLEFIELDS_REQUIRED) return 'battlefields';
  if (deck.runes.reduce((sum, r) => sum + r.count, 0) < RUNES_REQUIRED) return 'runes';
  return 'deck';
}

/** Cards that are a legal pick at the deck's current stage. */
export function stagePool(
  cards: readonly Card[],
  deck: Deck,
  byId: (cardId: string) => Card | null,
): Card[] {
  const legend = deck.legendId === null ? null : byId(deck.legendId);
  const stage = stageOf(deck);

  let pool: Card[];
  if (stage === 'legend') {
    pool = cards.filter((c) => c.type === 'legend');
  } else if (stage === 'champion') {
    pool = cards.filter((c) => matchesLegendChampion(c, legend));
  } else if (stage === 'battlefields') {
    // Battlefields carry no domain, so identity does not narrow them.
    pool = cards.filter((c) => c.type === 'battlefield');
  } else if (stage === 'runes') {
    pool = cards.filter((c) => c.type === 'rune' && fitsDomainIdentity(c, legend));
  } else {
    pool = cards.filter((c) => c.type !== 'legend' && c.type !== 'battlefield'
      && c.type !== 'rune' && fitsDomainIdentity(c, legend));
  }

  return pool.filter((c) => c.id !== deck.legendId
    && c.id !== deck.chosenChampionId
    && deck.battlefieldIds.indexOf(c.id) === -1);
}

export interface DomainGroup {
  /** e.g. "Fury / Order", or "Fury" for a single-domain legend. */
  label: string;
  cards: Card[];
}

/**
 * Group legends by their domain pairing.
 *
 * DESCRIPTIVE, not a ranking. A legend's domains come off its own card face, so
 * this is an organisation of the card pool. It is deliberately NOT a tier list:
 * Riot's policy forbids metagame-defining data — play rates, win rates, matchup
 * differentials — and ordering legends by strength is precisely that.
 */
export function groupByDomains(cards: readonly Card[]): DomainGroup[] {
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const label = card.domains.length === 0 ? 'No domain' : card.domains.slice().sort().join(' / ');
    const existing = groups.get(label);
    if (existing === undefined) groups.set(label, [card]);
    else existing.push(card);
  }

  const out: DomainGroup[] = [];
  groups.forEach((list, label) => {
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    out.push({ label, cards: list });
  });
  // Biggest groupings first, then alphabetical — stable across runs.
  out.sort((a, b) => (b.cards.length - a.cards.length)
    || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return out;
}

/** Ordered for browsing: grouped by domain pairing, flattened. */
export function browseOrder(cards: readonly Card[]): Card[] {
  const out: Card[] = [];
  for (const group of groupByDomains(cards)) for (const card of group.cards) out.push(card);
  return out;
}
