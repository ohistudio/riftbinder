import { test, assert, assertEqual } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { emptyCollection, applyScan, addCard, removeCard, countOf, resolveUnmatched, totalCards }
  from './.build/Collection.ts';
import { matchTranscription } from './.build/Matching.ts';
import { MemoryCardSource } from './.build/MemoryCardSource.ts';

const source = new MemoryCardSource(CARDS);
const OPTS = { autoAcceptThreshold: 0.82, maxAlternatives: 3, minAlternativeScore: 0.35 };
const scan = (name, num = null, set = null) =>
  matchTranscription({ name, collectorNumber: num, setCode: set }, source, OPTS);

test('duplicate scan increments count rather than creating a second entry', () => {
  let s = emptyCollection();
  s = applyScan(s, scan('Glass Sentinel'), 1000);
  s = applyScan(s, scan('Glass Sentinel'), 2000);
  s = applyScan(s, scan('Glass Sentmel'), 3000);   // OCR noise, same card
  assertEqual(s.entries.length, 1);
  assertEqual(countOf(s, 'tst-003-001'), 3);
  assertEqual(s.entries[0].firstScannedAt, 1000, 'firstScannedAt must not move');
});

test('below-threshold scan lands in the unmatched tray and adds nothing', () => {
  let s = emptyCollection();
  s = applyScan(s, scan('Lantern Warder of the Deep'), 1000);
  assertEqual(s.entries.length, 0);
  assertEqual(s.unmatched.length, 1);
  assert(s.unmatched[0].alternatives.length > 0);
});

test('PICK resolves an unmatched scan into the collection', () => {
  let s = emptyCollection();
  s = applyScan(s, scan('Lantern Warder of the Deep'), 1000);
  s = resolveUnmatched(s, 0, s.unmatched[0].alternatives[0], 2000);
  assertEqual(s.unmatched.length, 0);
  assertEqual(countOf(s, 'tst-001-001'), 1);
});

test('remove decrements, and drops the entry at zero', () => {
  let s = addCard(emptyCollection(), 'tst-001-001', 1000, 2);
  s = removeCard(s, 'tst-001-001');
  assertEqual(countOf(s, 'tst-001-001'), 1);
  s = removeCard(s, 'tst-001-001');
  assertEqual(s.entries.length, 0);
  assertEqual(removeCard(s, 'tst-001-001').entries.length, 0, 'removing absent card is a no-op');
});

test('reducers do not mutate their input', () => {
  const before = addCard(emptyCollection(), 'tst-001-001', 1000);
  const snapshot = JSON.stringify(before);
  addCard(before, 'tst-002-001', 2000);
  removeCard(before, 'tst-001-001');
  applyScan(before, scan('nothing at all like a card'), 3000);
  assertEqual(JSON.stringify(before), snapshot);
});

test('totalCards counts copies, not entries', () => {
  let s = addCard(emptyCollection(), 'tst-001-001', 1, 3);
  s = addCard(s, 'tst-002-001', 2, 2);
  assertEqual(s.entries.length, 2);
  assertEqual(totalCards(s), 5);
});
