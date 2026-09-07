// Binder — a deck as a printed sheet. Pure, no Lens Studio runtime.
//
// The deck wall arranges cards by energy so the curve is the layout, which is
// the right shape while you are BUILDING. A finished deck is read differently:
// by section, with counts, the way a decklist is written down and the way every
// deck site prints one. This turns a Deck into those sections.
//
// Ordering inside a section is energy then name, so the same deck always
// produces the same sheet — a list that reshuffles between views is unreadable.

import type { Card, Deck } from './Types.ts';

export interface SheetEntry {
  cardId: string;
  count: number;
  card: Card | null;
}

export interface SheetSection {
  /** UNIT, SPELL, GEAR, RUNES, SIDEBOARD. */
  title: string;
  entries: SheetEntry[];
  /** Cards, counting copies — what the header number shows. */
  total: number;
}

export interface DeckSheet {
  name: string;
  legend: Card | null;
  champion: Card | null;
  battlefields: Card[];
  /** Unit, spell and gear — only the sections that have cards. */
  main: SheetSection[];
  /** Main-deck total INCLUDING the chosen champion, per 103.2.a.2. */
  mainTotal: number;
  runes: SheetSection;
  sideboard: SheetSection;
}

/** The order sections are printed in, matching how a decklist is read. */
const MAIN_TYPES: { type: string; title: string }[] = [
  { type: 'unit', title: 'UNIT' },
  { type: 'spell', title: 'SPELL' },
  { type: 'gear', title: 'GEAR' },
];

function order(a: SheetEntry, b: SheetEntry): number {
  const ea = a.card === null || a.card.energy === null ? 99 : a.card.energy;
  const eb = b.card === null || b.card.energy === null ? 99 : b.card.energy;
  if (ea !== eb) return ea - eb;
  const na = a.card === null ? a.cardId : a.card.name;
  const nb = b.card === null ? b.cardId : b.card.name;
  return na < nb ? -1 : na > nb ? 1 : 0;
}

function section(
  title: string,
  slots: readonly { cardId: string; count: number }[],
  byId: (cardId: string) => Card | null,
  keep?: (card: Card | null) => boolean,
): SheetSection {
  const entries: SheetEntry[] = [];
  let total = 0;
  for (const slot of slots) {
    const card = byId(slot.cardId);
    if (keep !== undefined && !keep(card)) continue;
    entries.push({ cardId: slot.cardId, count: slot.count, card });
    total += slot.count;
  }
  entries.sort(order);
  return { title, entries, total };
}

export function buildDeckSheet(deck: Deck, byId: (cardId: string) => Card | null): DeckSheet {
  const legend = deck.legendId === null ? null : byId(deck.legendId);
  const champion = deck.chosenChampionId === null ? null : byId(deck.chosenChampionId);

  const battlefields: Card[] = [];
  for (const id of deck.battlefieldIds) {
    const card = byId(id);
    if (card !== null) battlefields.push(card);
  }

  const main: SheetSection[] = [];
  let mainTotal = 0;
  for (const group of MAIN_TYPES) {
    const built = section(group.title, deck.main, byId,
      (card) => card !== null && card.type === group.type);
    mainTotal += built.total;
    if (built.total > 0) main.push(built);
  }

  // Anything whose type is unreadable still belongs to the deck; drop it from
  // the printed sections but never from the count, or the sheet quietly
  // disagrees with the validator about how big the deck is.
  const typed = new Set<string>(MAIN_TYPES.map((g) => g.type));
  for (const slot of deck.main) {
    const card = byId(slot.cardId);
    if (card === null || !typed.has(card.type)) mainTotal += slot.count;
  }

  // The chosen champion sits in the Champion Zone, not the deck, but counts
  // toward the 40-card minimum — so the header has to include it.
  if (champion !== null) mainTotal += 1;

  return {
    name: deck.name,
    legend,
    champion,
    battlefields,
    main,
    mainTotal,
    runes: section('RUNES', deck.runes, byId),
    sideboard: section('SIDEBOARD', deck.sideboard, byId),
  };
}

/** The measurements the sheet is laid out with, so height can be derived. */
export interface SheetMetrics {
  tileHeightCm: number;
  gapCm: number;
  /** Cards per row in the right-hand block. */
  perRow: number;
  /** Vertical space a section heading takes. */
  headingCm: number;
  /** Space between one section and the next. */
  sectionGapCm: number;
  /** Everything above the first heading: title and top margin. */
  topCm: number;
  /** Margin under the last row. */
  bottomCm: number;
}

function rowsFor(count: number, perRow: number): number {
  return count <= 0 ? 0 : Math.ceil(count / Math.max(1, perRow));
}

/**
 * How tall the sheet needs to be to show everything.
 *
 * Derived rather than guessed: the sheet grew a sideboard and quietly ran off
 * the bottom of its own panel, which is the second time a panel in this project
 * has been sized by eye and been wrong.
 */
export function sheetHeightCm(sheet: DeckSheet, m: SheetMetrics): number {
  const sections: number[] = [];
  for (const part of sheet.main) sections.push(part.entries.length);
  if (sheet.runes.entries.length > 0) sections.push(sheet.runes.entries.length);
  // The sideboard heading ALWAYS takes a row, even at zero cards — the sheet
  // shows where it goes so you can see the deck has one place for it and it is
  // currently empty, rather than leaving you to wonder where it went.
  sections.push(sheet.sideboard.entries.length);

  // The MAIN DECK banner is a heading with no cards of its own.
  let height = m.topCm + m.headingCm;
  for (const count of sections) {
    height += m.headingCm
      + rowsFor(count, m.perRow) * (m.tileHeightCm + m.gapCm)
      + m.sectionGapCm;
  }

  // The left column runs independently; the sheet must clear whichever is taller.
  const leftRows = 1 + 1 + sheet.battlefields.length;
  const leftHeight = m.topCm + 3 * m.headingCm
    + leftRows * (m.tileHeightCm + m.gapCm) + 3 * m.sectionGapCm;

  return Math.max(height, leftHeight) + m.bottomCm;
}
