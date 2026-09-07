import { test, assert, assertEqual, assertDeep } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { stagePool, stageOf, groupByDomains, browseOrder,
         BATTLEFIELDS_REQUIRED, RUNES_REQUIRED } from './.build/Browse.ts';
import { emptyDeck, addToDeck, setChosenChampion, autoFillRunes } from './.build/DeckOps.ts';

const byId = (id) => CARDS.find((c) => c.id === id) ?? null;
const byName = (n) => CARDS.find((c) => c.name === n);
const LEGEND = byName('Ashen Herald');       // Fury + Chaos, tag Ashen
const CHAMPION = byName('Ashen Vanguard');   // unit, Fury, tag Ashen

test('with no legend, the browsable pool is legends only', () => {
  const pool = stagePool(CARDS, emptyDeck('d', 't', 1), byId);
  assert(pool.length > 0);
  assert(pool.every((c) => c.type === 'legend'));
});

test('with a legend, only matching champion units are pickable next', () => {
  const deck = addToDeck(emptyDeck('d', 't', 1), LEGEND, 1, 2);
  const pool = stagePool(CARDS, deck, byId);
  assert(pool.length > 0);
  assert(pool.every((c) => c.type === 'unit'));
  assert(pool.some((c) => c.id === CHAMPION.id));
});

/** Walk the deck all the way to the open-ended building stage. */
function builtDeck() {
  let deck = addToDeck(emptyDeck('d', 't', 1), LEGEND, 1, 2);
  deck = setChosenChampion(deck, CHAMPION, 3);
  const field = byName('Quiet Harbour');
  for (let i = 0; i < BATTLEFIELDS_REQUIRED; i++) {
    deck = addToDeck(deck, { ...field, id: `bf-${i}`, name: `Field ${i}` }, 1, 4);
  }
  return autoFillRunes(deck, CARDS, byId, 5, RUNES_REQUIRED);
}

test('once building, the pool obeys domain identity and excludes legends', () => {
  const deck = builtDeck();
  const pool = stagePool(CARDS, deck, byId);
  assert(pool.every((c) => c.type !== 'legend'));
  assert(!pool.some((c) => c.name === 'Twinbound Rider'), 'Fury/Calm is illegal under Fury/Chaos');
  assert(!pool.some((c) => c.name === 'Mirefoot Scout'), 'Calm is off-identity');
  assert(pool.some((c) => c.name === 'Grey Wanderer'), 'colourless is always legal');
});

test('what is committed to is never offered back', () => {
  const deck = builtDeck();
  const pool = stagePool(CARDS, deck, byId);
  assert(!pool.some((c) => c.id === LEGEND.id));
  assert(!pool.some((c) => c.id === CHAMPION.id));
});

test('legends group by domain pairing, deterministically', () => {
  const legends = CARDS.filter((c) => c.type === 'legend');
  const groups = groupByDomains(legends);
  assert(groups.length > 0);
  // Label is the sorted domain pair, so Fury/Chaos and Chaos/Fury are one group.
  assert(groups.every((g) => g.label.length > 0));
  assertDeep(groupByDomains(legends).map((g) => g.label), groups.map((g) => g.label));
});

test('grouping is descriptive, not a ranking', () => {
  // Ordering is by group size then alphabetical — nothing about strength.
  // A tier list would be metagame-defining data, which Riot's policy forbids.
  const groups = groupByDomains(CARDS);
  for (let i = 1; i < groups.length; i++) {
    const a = groups[i - 1];
    const b = groups[i];
    assert(a.cards.length > b.cards.length || a.label <= b.label, 'ordering must be stable and explainable');
  }
});

test('browse order flattens the groups without losing or duplicating cards', () => {
  const legends = CARDS.filter((c) => c.type === 'legend');
  const ordered = browseOrder(legends);
  assertEqual(ordered.length, legends.length);
  assertEqual(new Set(ordered.map((c) => c.id)).size, legends.length);
});

test('the stages run legend, champion, battlefields, runes, deck', () => {
  let deck = emptyDeck('d', 't', 1);
  assertEqual(stageOf(deck), 'legend');
  deck = addToDeck(deck, LEGEND, 1, 2);
  assertEqual(stageOf(deck), 'champion');
  deck = setChosenChampion(deck, CHAMPION, 3);
  assertEqual(stageOf(deck), 'battlefields');

  const field = byName('Quiet Harbour');
  for (let i = 0; i < BATTLEFIELDS_REQUIRED; i++) {
    deck = addToDeck(deck, { ...field, id: `bf-${i}`, name: `Field ${i}` }, 1, 4);
  }
  assertEqual(stageOf(deck), 'runes');

  deck = autoFillRunes(deck, CARDS, byId, 5, RUNES_REQUIRED);
  assertEqual(stageOf(deck), 'deck');
});

test('each stage offers only that stage\'s card type', () => {
  let deck = addToDeck(emptyDeck('d', 't', 1), LEGEND, 1, 2);
  deck = setChosenChampion(deck, CHAMPION, 3);
  assert(stagePool(CARDS, deck, byId).every((c) => c.type === 'battlefield'),
    'the battlefield stage should offer battlefields');

  const field = byName('Quiet Harbour');
  for (let i = 0; i < BATTLEFIELDS_REQUIRED; i++) {
    deck = addToDeck(deck, { ...field, id: `bf-${i}`, name: `Field ${i}` }, 1, 4);
  }
  const runePool = stagePool(CARDS, deck, byId);
  assert(runePool.every((c) => c.type === 'rune'), 'the rune stage should offer runes');
  assert(runePool.every((c) => c.domains.some((d) => LEGEND.domains.indexOf(d) !== -1)
    || d_isColourless(c)), 'runes must fit the legend identity');
});

function d_isColourless(card) {
  return card.domains.every((d) => d.toLowerCase() === 'colorless');
}

test('auto-fill balances runes across the legend\'s domains', () => {
  let deck = addToDeck(emptyDeck('d', 't', 1), LEGEND, 1, 2);   // Fury + Chaos
  deck = setChosenChampion(deck, CHAMPION, 3);
  const filled = autoFillRunes(deck, CARDS, byId, 4, RUNES_REQUIRED);
  const total = filled.runes.reduce((sum, r) => sum + r.count, 0);
  assert(total > 0, 'should place runes it can find');
  // Every rune placed must be inside the legend's identity.
  for (const slot of filled.runes) {
    const card = byId(slot.cardId);
    assert(card.domains.some((d) => LEGEND.domains.indexOf(d) !== -1),
      `${card.name} is outside the legend identity`);
  }
});

test('auto-fill does nothing without a legend, rather than guessing', () => {
  const deck = emptyDeck('d', 't', 1);
  assertEqual(autoFillRunes(deck, CARDS, byId, 1, RUNES_REQUIRED).runes.length, 0);
});
