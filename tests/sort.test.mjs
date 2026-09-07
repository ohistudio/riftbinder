import { test, assert, assertEqual, assertDeep } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { sortCards, sortLabel, nextSortMode, SORT_MODES } from './.build/Sort.ts';

const names = (cards) => cards.map((c) => c.name);

test('every mode has a label and the cycle returns to the start', () => {
  let mode = SORT_MODES[0];
  for (let i = 0; i < SORT_MODES.length; i++) {
    assert(sortLabel(mode).length > 0);
    mode = nextSortMode(mode);
  }
  assertEqual(mode, SORT_MODES[0], 'cycling through them all comes back round');
});

test('grouped leaves the caller\'s order alone', () => {
  assertDeep(names(sortCards(CARDS, 'grouped')), names(CARDS));
});

test('energy sorts ascending, with no-energy cards last rather than as zero', () => {
  const sorted = sortCards(CARDS, 'energy');
  let seenNull = false;
  let previous = -1;
  for (const card of sorted) {
    if (card.energy === null) { seenNull = true; continue; }
    assert(!seenNull, `${card.name} (energy ${card.energy}) came after a no-energy card`);
    assert(card.energy >= previous, 'energy must not decrease');
    previous = card.energy;
  }
});

test('name sorts alphabetically', () => {
  const sorted = names(sortCards(CARDS, 'name'));
  for (let i = 1; i < sorted.length; i++) {
    assert(sorted[i - 1] <= sorted[i], `${sorted[i - 1]} came before ${sorted[i]}`);
  }
});

test('rarity sorts common first, unknown last, and never claims to rank power', () => {
  const cards = [
    { ...CARDS[0], name: 'A', rarity: 'Rare' },
    { ...CARDS[0], name: 'B', rarity: 'Common' },
    { ...CARDS[0], name: 'C', rarity: null },
    { ...CARDS[0], name: 'D', rarity: 'Whatever' },
  ];
  assertDeep(names(sortCards(cards, 'rarity')), ['B', 'A', 'D', 'C']);
});

test('sorting is total, so identical keys keep a stable order', () => {
  const same = [
    { ...CARDS[0], name: 'Zeta', energy: 2 },
    { ...CARDS[0], name: 'Alpha', energy: 2 },
  ];
  assertDeep(names(sortCards(same, 'energy')), ['Alpha', 'Zeta'], 'ties fall back to name');
});

test('sorting never drops or duplicates a card', () => {
  for (const mode of SORT_MODES) {
    const sorted = sortCards(CARDS, mode);
    assertEqual(sorted.length, CARDS.length, mode);
    assertEqual(new Set(sorted.map((c) => c.id)).size, new Set(CARDS.map((c) => c.id)).size, mode);
  }
});

test('sorting does not mutate the input', () => {
  const before = names(CARDS);
  sortCards(CARDS, 'name');
  assertDeep(names(CARDS), before);
});
