import { test, assert, assertEqual } from './harness.mjs';
import { splitSetFromNumber, parseVisionResponse } from './.build/VisionPrompt.ts';

test('a set code swallowed by the number is split back out', () => {
  // The real failure: Gemini read "UNL • 120/219" and returned the whole run as
  // the number, leaving the set null and throwing the set away.
  for (const raw of ['UNL 120', 'UNL-120', 'UNL•120', 'UNL · 120', 'unl120']) {
    const out = splitSetFromNumber(raw, null);
    assertEqual(out.collectorNumber, '120', `from ${raw}`);
    assertEqual(out.setCode, 'UNL', `from ${raw}`);
  }
});

test('a set the model actually transcribed is never overwritten', () => {
  const out = splitSetFromNumber('UNL 120', 'OGN');
  assertEqual(out.collectorNumber, '120');
  assertEqual(out.setCode, 'OGN');
});

test('a plain number is left alone', () => {
  const out = splitSetFromNumber('120', null);
  assertEqual(out.collectorNumber, '120');
  assertEqual(out.setCode, null);
  assertEqual(splitSetFromNumber(null, 'UNL').collectorNumber, null);
});

test('names that merely look numeric are not mangled', () => {
  // Guard against the pattern eating things that are not set+number.
  for (const raw of ['120/219', 'RENGAR', '1234567']) {
    assertEqual(splitSetFromNumber(raw, null).collectorNumber, raw, `from ${raw}`);
  }
});

test('the whole reply parses with the set recovered', () => {
  const out = parseVisionResponse('{"name":"Rengar","collectorNumber":"UNL 120","setCode":null}');
  assertEqual(out.name, 'Rengar');
  assertEqual(out.collectorNumber, '120');
  assertEqual(out.setCode, 'UNL');
});
