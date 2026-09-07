import { test, assert, assertEqual, assertDeep } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { normalizeCollectorNumber, matchTranscription } from './.build/Matching.ts';
import { MemoryCardSource } from './.build/MemoryCardSource.ts';

const source = new MemoryCardSource(CARDS);
const OPTS = { autoAcceptThreshold: 0.82, maxAlternatives: 3, minAlternativeScore: 0.35 };

test('search: exact name returns that card first with score 1', () => {
  const [top] = source.search('Glass Sentinel', 3);
  assertEqual(top.card.id, 'tst-003-001');
  assertEqual(top.score, 1);
});

test('search: one character of OCR noise still ranks the right card first', () => {
  for (const noisy of ['Glass Sentmel', 'Lantem Warden', 'Emberfall Rlte']) {
    const [top] = source.search(noisy, 3);
    assert(top.score >= OPTS.autoAcceptThreshold, `${noisy} scored ${top.score}`);
  }
  assertEqual(source.search('Glass Sentmel', 1)[0].card.id, 'tst-003-001');
  assertEqual(source.search('Lantem Warden', 1)[0].card.id, 'tst-001-001');
});

test('search: genuine non-match scores below the auto-accept threshold', () => {
  const [top] = source.search('Blackwater Cartographer', 3);
  assert(top.score < OPTS.autoAcceptThreshold, `non-match scored ${top.score}`);
});

test('collector number beats a conflicting name match', () => {
  // Name reads as TST-003 exactly; the printed number says TST-001.
  const result = matchTranscription(
    { name: 'Glass Sentinel', collectorNumber: '001', setCode: 'TST' },
    source, OPTS,
  );
  assertEqual(result.matched, 'tst-001-001');
  assertEqual(result.confidence, 1);
});

test('leading zeros and punctuation do not change a collector number', () => {
  assertEqual(normalizeCollectorNumber('007'), '7');
  assertEqual(normalizeCollectorNumber('7'), '7');
  assertEqual(normalizeCollectorNumber('  0 0 7 '), '7');
  assert(normalizeCollectorNumber('P07') !== normalizeCollectorNumber('07'));
});

test('ambiguous collector number falls back to the name, within that number', () => {
  const result = matchTranscription(
    { name: 'Sunward Pilgrim', collectorNumber: '008', setCode: null },
    source, OPTS,
  );
  assertEqual(result.matched, 'alt-008-001');
});

test('below threshold: alternatives surfaced, nothing auto-matched', () => {
  const result = matchTranscription(
    { name: 'Lantern Warder of the Deep', collectorNumber: null, setCode: null },
    source, OPTS,
  );
  assertEqual(result.matched, null);
  assert(result.alternatives.length > 0, 'expected alternatives');
  assert(result.alternatives.length <= OPTS.maxAlternatives, 'too many alternatives');
  assertEqual(result.alternatives[0], 'tst-001-001');
});

test('confidence is the local match score, and raw text is preserved verbatim', () => {
  const result = matchTranscription(
    { name: 'Glass  Sentinel', collectorNumber: null, setCode: null },
    source, OPTS,
  );
  assertEqual(result.rawName, 'Glass  Sentinel');
  assertEqual(result.matched, 'tst-003-001');
  assertEqual(result.confidence, 1);
});

test('unreadable everything matches nothing', () => {
  const result = matchTranscription({ name: null, collectorNumber: null, setCode: null }, source, OPTS);
  assertEqual(result.matched, null);
  assertDeep(result.alternatives, []);
});

test('a misread set code cannot veto a card the number and name single out', () => {
  // "UNI" for UNL is one letter out. The number is shared across sets, so
  // the set code was the tiebreak — and a wrong one used to leave the read
  // unmatched even though only one #120 is called Rengar.
  // 008 exists in two sets in the fixture: Mirefoot Scout (TST) and Sunward
  // Pilgrim (ALT). A wrong set code with the right name must still resolve.
  const result = matchTranscription(
    { name: 'Mirefoot Scout', collectorNumber: '008', setCode: 'ZZZ' }, source, OPTS);
  assert(result.matched !== null, 'name + number identify exactly one printing');
  assertEqual(source.byId(result.matched).name, 'Mirefoot Scout');
});

test('a bad set code still never chooses between two plausible cards', () => {
  // Two different names on the same number: the name must decide, and a
  // read that matches neither stays unmatched rather than guessing.
  const result = matchTranscription(
    { name: 'Nobody', collectorNumber: '008', setCode: 'ZZZ' }, source, OPTS);
  assertEqual(result.matched, null);
});
