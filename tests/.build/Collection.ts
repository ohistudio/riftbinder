// Binder — collection state. Pure reducers, no Lens Studio runtime.
// Every function returns new state; nothing mutates its input.

import type { CollectionEntry, ScanResult } from './Types.ts';

export interface CollectionState {
  entries: CollectionEntry[];
  /** Scans that did not clear the threshold. Visible tray, never dropped. */
  unmatched: ScanResult[];
}

export function emptyCollection(): CollectionState {
  return { entries: [], unmatched: [] };
}

export function countOf(state: CollectionState, cardId: string): number {
  const found = state.entries.find((e) => e.cardId === cardId);
  return found === undefined ? 0 : found.count;
}

/** A rescan of a known card increments count; it never creates a second entry. */
export function addCard(state: CollectionState, cardId: string, now: number, by = 1): CollectionState {
  const index = state.entries.findIndex((e) => e.cardId === cardId);
  if (index === -1) {
    return {
      entries: state.entries.concat([{ cardId, count: by, firstScannedAt: now }]),
      unmatched: state.unmatched,
    };
  }
  const entries = state.entries.slice();
  entries[index] = { ...entries[index], count: entries[index].count + by };
  return { entries, unmatched: state.unmatched };
}

export function removeCard(state: CollectionState, cardId: string, by = 1): CollectionState {
  const index = state.entries.findIndex((e) => e.cardId === cardId);
  if (index === -1) return state;
  const next = state.entries[index].count - by;
  const entries = state.entries.slice();
  if (next <= 0) entries.splice(index, 1);
  else entries[index] = { ...entries[index], count: next };
  return { entries, unmatched: state.unmatched };
}

/**
 * Apply a scan. Below threshold the card goes to the unmatched tray and is
 * never auto-added, however tempting the top alternative looks.
 */
export function applyScan(state: CollectionState, scan: ScanResult, now: number): CollectionState {
  if (scan.matched !== null) return addCard(state, scan.matched, now);
  return { entries: state.entries, unmatched: state.unmatched.concat([scan]) };
}

/** PICK intent: the user chose one of an unmatched scan's alternatives. */
export function resolveUnmatched(
  state: CollectionState,
  unmatchedIndex: number,
  cardId: string,
  now: number,
): CollectionState {
  if (unmatchedIndex < 0 || unmatchedIndex >= state.unmatched.length) return state;
  const unmatched = state.unmatched.slice();
  unmatched.splice(unmatchedIndex, 1);
  const added = addCard(state, cardId, now);
  return { entries: added.entries, unmatched };
}

export function totalCards(state: CollectionState): number {
  return state.entries.reduce((sum, e) => sum + e.count, 0);
}
