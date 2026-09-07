import { test, assert, assertEqual } from './harness.mjs';
import { HINTS, nextHint } from './.build/Hints.ts';

test('there are hints, and none of them is empty', () => {
  assert(HINTS.length > 1, 'a single hint would repeat forever');
  for (const hint of HINTS) {
    assert(typeof hint === 'string' && hint.trim().length > 0);
  }
});

test('a hint never immediately repeats itself', () => {
  // The one property that matters while waiting: the screen changes.
  for (let previous = 0; previous < HINTS.length; previous++) {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const picked = nextHint(previous, roll);
      assert(picked.index !== previous,
        `roll ${roll} after ${previous} repeated the same hint`);
    }
  }
});

test('every hint is reachable', () => {
  // A picker that can never show hint N is a picker with a bug in its maths.
  const seen = new Set();
  for (let previous = 0; previous < HINTS.length; previous++) {
    for (let i = 0; i < 40; i++) seen.add(nextHint(previous, i / 40).index);
  }
  assertEqual(seen.size, HINTS.length);
});

test('the index it returns always matches the text', () => {
  const picked = nextHint(0, 0.4);
  assertEqual(picked.text, HINTS[picked.index]);
});

test('a nonsense roll still yields a usable hint', () => {
  // Math.random() cannot return these, but a caller passing a stale or
  // uninitialised number should not blank the line.
  for (const roll of [NaN, -1, 1, 42, Infinity]) {
    const picked = nextHint(2, roll);
    assert(picked.text.length > 0, `roll ${roll} produced nothing`);
    assert(picked.index !== 2);
  }
});

test('no previous hint yet is a valid starting state', () => {
  const picked = nextHint(-1, 0.5);
  assert(picked.index >= 0 && picked.index < HINTS.length);
  assert(picked.text.length > 0);
});
