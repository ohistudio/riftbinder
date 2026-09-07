// Binder — how the card panel is ordered. Pure.
//
// Ordering only. Nothing here ranks cards by strength: a power ordering is
// metagame-defining data, which Riot's policy prohibits (see Browse.ts). Rarity
// sorting below is a PRINT classification that comes off the card face, in the
// conventional common-to-rarest reading order — it says nothing about which
// card is better.

import type { Card } from './Types.ts';

export type SortMode = 'grouped' | 'energy' | 'name' | 'rarity';

export const SORT_MODES: SortMode[] = ['grouped', 'energy', 'name', 'rarity'];

export function sortLabel(mode: SortMode): string {
  if (mode === 'energy') return 'Energy';
  if (mode === 'name') return 'Name';
  if (mode === 'rarity') return 'Rarity';
  return 'Domain';
}

export function nextSortMode(mode: SortMode): SortMode {
  const index = SORT_MODES.indexOf(mode);
  return SORT_MODES[(index + 1) % SORT_MODES.length];
}

/**
 * Print classifications, least to most scarce. Anything unrecognised sorts
 * last rather than being dropped or guessed at.
 */
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

function rarityRank(card: Card): number {
  if (card.rarity === null) return RARITY_ORDER.length + 1;
  const index = RARITY_ORDER.indexOf(card.rarity.trim().toLowerCase());
  return index === -1 ? RARITY_ORDER.length : index;
}

function byName(a: Card, b: Card): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Cards with no energy sort after those that have one, never as zero. */
function byEnergy(a: Card, b: Card): number {
  const ae = a.energy === null ? Number.MAX_SAFE_INTEGER : a.energy;
  const be = b.energy === null ? Number.MAX_SAFE_INTEGER : b.energy;
  return ae - be;
}

/**
 * Sort a copy. `grouped` is returned untouched — the caller has already grouped
 * by domain pairing (Browse.browseOrder), and re-sorting would undo it.
 *
 * Every mode falls back to name, so the order is total: two cards of the same
 * energy keep a stable, predictable position instead of shuffling between
 * renders.
 */
export function sortCards(cards: readonly Card[], mode: SortMode): Card[] {
  if (mode === 'grouped') return cards.slice();
  const out = cards.slice();
  if (mode === 'name') out.sort(byName);
  else if (mode === 'energy') out.sort((a, b) => byEnergy(a, b) || byName(a, b));
  else out.sort((a, b) => (rarityRank(a) - rarityRank(b)) || byName(a, b));
  return out;
}
