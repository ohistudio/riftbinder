// Binder — the decks you have saved. Pure, no Lens Studio runtime.
//
// A deckbuilder that can only hold one deck is a deck editor. This is the
// shelf: several decks, saved by name, reopened later.
//
// Serialisation is deliberately explicit rather than JSON.stringify(deck) —
// a stored blob outlives the code that wrote it, so every field is read back
// defensively and a corrupt or half-written entry is dropped rather than
// crashing the Lens on load.

import type { Deck } from './Types.ts';

export interface DeckLibrary {
  decks: Deck[];
}

export function emptyLibrary(): DeckLibrary {
  return { decks: [] };
}

function slots(raw: unknown): { cardId: string; count: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { cardId: string; count: number }[] = [];
  for (const entry of raw) {
    const cardId = typeof entry?.cardId === 'string' ? entry.cardId : null;
    const count = typeof entry?.count === 'number' ? Math.floor(entry.count) : 0;
    if (cardId !== null && cardId.length > 0 && count > 0) out.push({ cardId, count });
  }
  return out;
}

function ids(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => typeof v === 'string' && v.length > 0) as string[];
}

function optionalId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** Read one deck back, or null if it is not one. */
export function parseDeck(raw: unknown): Deck | null {
  if (raw === null || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = typeof source.id === 'string' ? source.id : '';
  if (id.length === 0) return null;

  return {
    id,
    name: typeof source.name === 'string' ? source.name : 'Untitled deck',
    legendId: optionalId(source.legendId),
    chosenChampionId: optionalId(source.chosenChampionId),
    main: slots(source.main),
    runes: slots(source.runes),
    battlefieldIds: ids(source.battlefieldIds),
    sideboard: slots(source.sideboard),
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : 0,
  };
}

/** Newest first: the deck you were last working on is the one you want. */
export function parseLibrary(json: string): DeckLibrary {
  if (json.length === 0) return emptyLibrary();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return emptyLibrary();
  }
  const raw = (parsed as { decks?: unknown })?.decks;
  if (!Array.isArray(raw)) return emptyLibrary();

  const decks: Deck[] = [];
  for (const entry of raw) {
    const deck = parseDeck(entry);
    if (deck !== null) decks.push(deck);
  }
  decks.sort((a, b) => b.updatedAt - a.updatedAt);
  return { decks };
}

export function serialiseLibrary(library: DeckLibrary): string {
  return JSON.stringify({ decks: library.decks });
}

/**
 * Save a deck, replacing any earlier save of the SAME deck.
 *
 * Matched on id, not name: two decks may share a name, and overwriting by name
 * would silently destroy one of them.
 */
export function saveDeck(library: DeckLibrary, deck: Deck, now: number): DeckLibrary {
  const stamped: Deck = { ...deck, updatedAt: now };
  const decks = library.decks.filter((d) => d.id !== deck.id);
  decks.unshift(stamped);
  return { decks };
}

export function removeDeck(library: DeckLibrary, deckId: string): DeckLibrary {
  return { decks: library.decks.filter((d) => d.id !== deckId) };
}

export function findDeck(library: DeckLibrary, deckId: string): Deck | null {
  const found = library.decks.filter((d) => d.id === deckId);
  return found.length > 0 ? found[0] : null;
}

/** A short description for the shelf: what the deck is, without opening it. */
export function describeDeck(deck: Deck, byId: (cardId: string) => { name: string } | null): string {
  const main = deck.main.reduce((sum, s) => sum + s.count, 0)
    + (deck.chosenChampionId === null ? 0 : 1);
  const legend = deck.legendId === null ? null : byId(deck.legendId);
  const who = legend === null ? 'No legend' : legend.name;
  return `${who}  ·  ${main} main  ·  ${deck.battlefieldIds.length} battlefields`;
}
