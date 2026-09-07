// Binder — export. Pure.
//
// Two artifacts, and the second is the point (BINDER.md § Export):
//   1. Decklist — plain text, must ROUND-TRIP to an identical Deck.
//   2. Pull list — the same cards by set and ascending collector number, which
//      is the order you flip through a sorted box. This is the bridge back to
//      the physical cards.
//
// The decklist writes printing ids, not names: names are ambiguous across
// printings (alternate art, signature) and a round-trip that silently changed
// which printing you owned would be worse than useless.

import type { Card, CardSource, Deck } from './Types.ts';
import { emptyDeck } from './DeckOps.ts';

const LEGEND_HEADER = '# Legend';
const MAIN_HEADER = '# Main';
const RUNE_HEADER = '# Runes';
const FIELD_HEADER = '# Battlefields';
const SIDE_HEADER = '# Sideboard';

function line(count: number, card: Card | null, cardId: string): string {
  const name = card === null ? '?' : card.name;
  return `${count} ${cardId} ${name}`;
}

export function exportDecklist(deck: Deck, source: CardSource): string {
  const out: string[] = [`# ${deck.name}`];

  out.push(LEGEND_HEADER);
  if (deck.legendId !== null) out.push(line(1, source.byId(deck.legendId), deck.legendId));

  out.push(MAIN_HEADER);
  for (const slot of deck.main) out.push(line(slot.count, source.byId(slot.cardId), slot.cardId));

  out.push(RUNE_HEADER);
  for (const slot of deck.runes) out.push(line(slot.count, source.byId(slot.cardId), slot.cardId));

  out.push(FIELD_HEADER);
  for (const id of deck.battlefieldIds) out.push(line(1, source.byId(id), id));

  out.push(SIDE_HEADER);
  for (const slot of deck.sideboard) out.push(line(slot.count, source.byId(slot.cardId), slot.cardId));

  return out.join('\n');
}

/**
 * Parse a decklist back. Trailing names are ignored — the id is authoritative,
 * so a list stays importable after a card is renamed in the data.
 */
export function importDecklist(text: string, id: string, now: number): Deck {
  const deck = emptyDeck(id, 'Imported Deck', now);
  let section: 'legend' | 'main' | 'runes' | 'fields' | 'side' | null = null;

  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;

    if (trimmed === LEGEND_HEADER) { section = 'legend'; continue; }
    if (trimmed === MAIN_HEADER) { section = 'main'; continue; }
    if (trimmed === RUNE_HEADER) { section = 'runes'; continue; }
    if (trimmed === FIELD_HEADER) { section = 'fields'; continue; }
    if (trimmed === SIDE_HEADER) { section = 'side'; continue; }
    if (trimmed.charAt(0) === '#') { deck.name = trimmed.slice(1).trim(); continue; }

    const match = trimmed.match(/^(\d+)\s+(\S+)/);
    if (match === null || section === null) continue;
    const count = parseInt(match[1], 10);
    const cardId = match[2];
    if (!isFinite(count) || count <= 0) continue;

    if (section === 'legend') deck.legendId = cardId;
    else if (section === 'main') deck.main.push({ cardId, count });
    else if (section === 'runes') deck.runes.push({ cardId, count });
    else if (section === 'side') deck.sideboard.push({ cardId, count });
    else deck.battlefieldIds.push(cardId);
  }

  return deck;
}

export interface PullListEntry {
  setCode: string;
  collectorNumber: string;
  cardId: string;
  name: string;
  count: number;
}

/**
 * Collector numbers sort NUMERICALLY, with variant suffixes ordered after the
 * plain printing — '7' before '10', and '116' before '116a'. A lexicographic
 * sort would put '10' before '7' and send you back and forth through the box.
 */
export function compareCollectorNumbers(a: string, b: string): number {
  const parse = (value: string): { num: number; suffix: string } => {
    const m = value.match(/^(\d+)(.*)$/);
    return m === null ? { num: Number.MAX_SAFE_INTEGER, suffix: value } : { num: parseInt(m[1], 10), suffix: m[2] };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.num !== pb.num) return pa.num - pb.num;
  return pa.suffix < pb.suffix ? -1 : pa.suffix > pb.suffix ? 1 : 0;
}

/** Every card in the deck, grouped by set, in box order. */
export function buildPullList(deck: Deck, source: CardSource): PullListEntry[] {
  const counts = new Map<string, number>();
  const bump = (cardId: string, by: number): void => {
    counts.set(cardId, (counts.get(cardId) ?? 0) + by);
  };

  if (deck.legendId !== null) bump(deck.legendId, 1);
  for (const slot of deck.main) bump(slot.cardId, slot.count);
  for (const slot of deck.runes) bump(slot.cardId, slot.count);
  for (const slot of deck.sideboard) bump(slot.cardId, slot.count);
  for (const id of deck.battlefieldIds) bump(id, 1);

  const entries: PullListEntry[] = [];
  counts.forEach((count, cardId) => {
    const card = source.byId(cardId);
    entries.push({
      setCode: card === null ? '?' : card.setCode,
      collectorNumber: card === null ? '' : card.collectorNumber,
      cardId,
      name: card === null ? cardId : card.name,
      count,
    });
  });

  entries.sort((a, b) => {
    if (a.setCode !== b.setCode) return a.setCode < b.setCode ? -1 : 1;
    return compareCollectorNumbers(a.collectorNumber, b.collectorNumber);
  });
  return entries;
}

export function formatPullList(entries: readonly PullListEntry[]): string {
  const out: string[] = [];
  let currentSet: string | null = null;
  for (const entry of entries) {
    if (entry.setCode !== currentSet) {
      currentSet = entry.setCode;
      out.push(`## ${currentSet}`);
    }
    out.push(`  ${entry.collectorNumber.padStart(4, ' ')}  x${entry.count}  ${entry.name}`);
  }
  return out.join('\n');
}
