import { test, assert, assertEqual } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { MemoryCardSource } from './.build/MemoryCardSource.ts';
import { buildStarterDeck, buildStarterDecks } from './.build/StarterDecks.ts';
import { validate, errorCount } from './.build/Validate.ts';
import { mainDeckSize, runeDeckSize } from './.build/DeckOps.ts';
import { Rules } from './.build/Rules.ts';

const source = new MemoryCardSource(CARDS);
const LEGEND = CARDS.find((c) => c.name === 'Ashen Herald');

test('a legend is required — anything else builds nothing', () => {
  const notALegend = CARDS.find((c) => c.type === 'unit');
  assertEqual(buildStarterDeck(CARDS, notALegend, 1, 'x'), null);
});

test('a built deck names its legend and never rates it', () => {
  const deck = buildStarterDeck(CARDS, LEGEND, 1, 'starter-1');
  if (deck === null) return;   // the tiny fixture may not sustain 40 cards
  assert(deck.name.indexOf('Ashen') !== -1, 'the name should say what it is');
  // No claim about performance: BINDER.md rules metagame framing out.
  for (const word of ['best', 'top', 'meta', 'tier', 'competitive']) {
    assertEqual(deck.name.toLowerCase().indexOf(word), -1,
      `"${word}" would read as a recommendation`);
  }
});

test('the same catalogue always builds the same deck', () => {
  // These are seeded once and then belong to the user; a deck that changed
  // shape between runs would rewrite what they thought they had saved.
  const a = buildStarterDeck(CARDS, LEGEND, 1, 'starter-1');
  const b = buildStarterDeck(CARDS, LEGEND, 1, 'starter-1');
  assertEqual(JSON.stringify(a), JSON.stringify(b));
});

test('a deck it does build is one the validator accepts', () => {
  const deck = buildStarterDeck(CARDS, LEGEND, 1, 'starter-1');
  if (deck === null) return;
  assertEqual(errorCount(validate(deck, source)), 0,
    'a seeded deck must not open with errors against it');
  assert(mainDeckSize(deck) >= Rules.mainMinimum.value);
  assertEqual(runeDeckSize(deck), Rules.runeDeckSize.value);
  assertEqual(deck.battlefieldIds.length, Rules.battlefieldCount.value);
});

test('a legend that cannot sustain a legal deck yields null, not a broken one', () => {
  // Better an empty shelf than a shelf of decks the validator complains about.
  const lonely = { ...LEGEND, id: 'tst-999-001', domains: ['Nowhere'] };
  const deck = buildStarterDeck([lonely], lonely, 1, 'x');
  assertEqual(deck, null);
});

test('the shelf never repeats a legend', () => {
  const decks = buildStarterDecks(CARDS, 1, 3);
  const names = decks.map((d) => d.legendId);
  assertEqual(new Set(names).size, names.length);
});

test('asking for none gives none', () => {
  assertEqual(buildStarterDecks(CARDS, 1, 0).length, 0);
});
