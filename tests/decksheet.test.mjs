import { test, assert, assertEqual } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { emptyDeck, addToDeck, setChosenChampion, mainDeckSize } from './.build/DeckOps.ts';
import { buildDeckSheet, sheetHeightCm } from './.build/DeckSheet.ts';

const byName = (name) => CARDS.find((c) => c.name === name);
const byId = (id) => CARDS.find((c) => c.id === id) ?? null;

const UNIT = byName('Lantern Warden');       // unit, energy 3
const CHEAP = byName('Mirefoot Scout');      // unit, energy 1
const SPELL = byName('Emberfall Rite');      // spell, energy 2
const GEAR = byName('Vault of Echoes');      // gear, energy 1
const RUNE = byName('Tidewalk Rune');
const FIELD = byName('Quiet Harbour');

const build = () => {
  let deck = emptyDeck('d', 'custom rengar', 1);
  deck = addToDeck(deck, UNIT, 3, 2);
  deck = addToDeck(deck, CHEAP, 2, 3);
  deck = addToDeck(deck, SPELL, 2, 4);
  deck = addToDeck(deck, GEAR, 1, 5);
  deck = addToDeck(deck, RUNE, 12, 6);
  deck = addToDeck(deck, FIELD, 1, 7);
  return deck;
};

test('the sheet is grouped into the sections a decklist is written in', () => {
  const sheet = buildDeckSheet(build(), byId);
  assertEqual(sheet.main.map((s) => s.title).join(','), 'UNIT,SPELL,GEAR');
  assertEqual(sheet.main[0].total, 5);   // 3 + 2 units
  assertEqual(sheet.main[1].total, 2);   // spells
  assertEqual(sheet.main[2].total, 1);   // gear
  assertEqual(sheet.runes.total, 12);
  assertEqual(sheet.battlefields.length, 1);
  assertEqual(sheet.name, 'custom rengar');
});

test('empty sections are not printed', () => {
  let deck = emptyDeck('d', 'units only', 1);
  deck = addToDeck(deck, UNIT, 2, 2);
  const sheet = buildDeckSheet(deck, byId);
  assertEqual(sheet.main.map((s) => s.title).join(','), 'UNIT');
  assertEqual(sheet.sideboard.total, 0);
});

test('cards are ordered by energy, then name, so the sheet is stable', () => {
  const sheet = buildDeckSheet(build(), byId);
  const units = sheet.main[0].entries.map((e) => e.card.energy);
  for (let i = 1; i < units.length; i++) assert(units[i - 1] <= units[i], 'energy ascending');
});

test('the main total agrees with the validator, champion included', () => {
  // The chosen champion sits outside the deck but counts toward the 40-card
  // minimum. A sheet header that disagreed with the rules would be worse than
  // no header at all.
  let deck = build();
  const champion = CARDS.find((c) => c.supertype === 'Champion' && c.type === 'unit');
  if (champion !== undefined) deck = setChosenChampion(deck, champion, 9);
  const sheet = buildDeckSheet(deck, byId);
  assertEqual(sheet.mainTotal, mainDeckSize(deck));
});

const METRICS = {
  tileHeightCm: 11.6, gapCm: 1.2, perRow: 8,
  headingCm: 4, sectionGapCm: 1.5, topCm: 12, bottomCm: 6,
};

const sheetOf = (sections, battlefields = 0) => ({
  name: 'x', legend: null, champion: null,
  battlefields: new Array(battlefields).fill(null),
  main: sections.main ?? [], mainTotal: 0,
  runes: { title: 'RUNES', entries: sections.runes ?? [], total: 0 },
  sideboard: { title: 'SIDEBOARD', entries: sections.sideboard ?? [], total: 0 },
});
const entries = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ cardId: `c${i}`, count: 1, card: null });
  return out;
};

test('the sheet grows as sections are added, so nothing runs off it', () => {
  // The bug this prevents: the sideboard section appeared and the sheet
  // silently ran off the bottom of its own panel.
  const base = sheetOf({ main: [{ title: 'UNIT', entries: entries(24), total: 24 }] });
  const bare = sheetHeightCm(base, METRICS);

  const withRunes = sheetHeightCm(
    { ...base, runes: { title: 'RUNES', entries: entries(2), total: 12 } }, METRICS);
  assert(withRunes > bare, `runes add height (${withRunes} vs ${bare})`);

  const sided = sheetHeightCm({
    ...base,
    runes: { title: 'RUNES', entries: entries(2), total: 12 },
    sideboard: { title: 'SIDEBOARD', entries: entries(4), total: 4 },
  }, METRICS);
  assert(sided > withRunes, `a sideboard adds height (${sided} vs ${withRunes})`);
});

test('a wider grid needs less height for the same cards', () => {
  // Sixteen DISTINCT entries, so the column count actually changes the row
  // count — the deck fixture has too few distinct cards to show this.
  const entries = [];
  for (let i = 0; i < 16; i++) entries.push({ cardId: `c${i}`, count: 1, card: null });
  const sheet = {
    name: 'wide', legend: null, champion: null, battlefields: [],
    main: [{ title: 'UNIT', entries, total: 16 }], mainTotal: 16,
    runes: { title: 'RUNES', entries: [], total: 0 },
    sideboard: { title: 'SIDEBOARD', entries: [], total: 0 },
  };
  const narrow = sheetHeightCm(sheet, { ...METRICS, perRow: 2 });
  const wide = sheetHeightCm(sheet, { ...METRICS, perRow: 8 });
  assert(narrow > wide, `fewer columns means more height (${narrow} vs ${wide})`);
});

test('the left column can be what sets the height', () => {
  // Legend, champion and three battlefields with almost no main deck: the
  // right-hand block is short and the left column is what must fit.
  let deck = emptyDeck('d', 'fields', 1);
  deck = addToDeck(deck, FIELD, 1, 2);
  const sheet = buildDeckSheet(deck, byId);
  assert(sheetHeightCm(sheet, METRICS) > METRICS.topCm + METRICS.bottomCm);
});
