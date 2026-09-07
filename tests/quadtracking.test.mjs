import { test, assert, assertEqual, assertDeep } from './harness.mjs';
import { QuadAssociator } from './.build/QuadTracking.ts';

const quad = (cx, cy, side = 20) => ({
  x: cx - side / 2, y: cy - side / 2,
  width: side * 0.716, height: side,
  cx, cy,
  area: side * side * 0.716, aspect: 0.716, fill: 1,
});

test('a card held still keeps the same id', () => {
  const a = new QuadAssociator();
  const first = a.update([quad(30, 20)], 1000).current[0].trackerId;
  const second = a.update([quad(30, 20)], 1033).current[0].trackerId;
  const third = a.update([quad(31, 21)], 1066).current[0].trackerId;
  assertEqual(second, first);
  assertEqual(third, first);
});

test('a card drifting frame to frame keeps its id', () => {
  const a = new QuadAssociator();
  let id = a.update([quad(10, 10)], 1000).current[0].trackerId;
  for (let step = 1; step <= 8; step++) {
    const now = a.update([quad(10 + step * 3, 10 + step * 2)], 1000 + step * 33);
    assertEqual(now.current[0].trackerId, id, `id changed at step ${step}`);
  }
});

test('a jump too large for one frame is treated as a new card', () => {
  const a = new QuadAssociator();
  const first = a.update([quad(10, 10)], 1000).current[0].trackerId;
  const result = a.update([quad(55, 40)], 1033);
  assert(result.current[0].trackerId !== first, 'teleport should not keep the id');
  assertDeep(result.lost, [first]);
});

test('two cards get distinct, stable ids', () => {
  const a = new QuadAssociator();
  const start = a.update([quad(10, 10), quad(50, 30)], 1000).current;
  assertEqual(new Set(start.map((t) => t.trackerId)).size, 2);

  const next = a.update([quad(11, 11), quad(51, 31)], 1033).current;
  const idFor = (cx) => next.find((t) => Math.abs(t.quad.cx - cx) < 3).trackerId;
  const startIdFor = (cx) => start.find((t) => Math.abs(t.quad.cx - cx) < 3).trackerId;
  assertEqual(idFor(11), startIdFor(10));
  assertEqual(idFor(51), startIdFor(50));
});

test('a card leaving frame is reported lost exactly once', () => {
  const a = new QuadAssociator();
  const id = a.update([quad(10, 10)], 1000).current[0].trackerId;
  const gone = a.update([], 1033);
  assertDeep(gone.lost, [id]);
  assertEqual(gone.current.length, 0);
  assertDeep(a.update([], 1066).lost, [], 'a lost track must not be reported again');
});

test('a returning card gets a fresh id, so identity is re-established', () => {
  const a = new QuadAssociator();
  const first = a.update([quad(10, 10)], 1000).current[0].trackerId;
  a.update([], 1033);
  const again = a.update([quad(10, 10)], 1066).current[0].trackerId;
  assert(again !== first, 'a re-appearance must not silently reuse a stale binding');
});

test('a large size change breaks the match rather than mis-tracking', () => {
  const a = new QuadAssociator();
  const first = a.update([quad(30, 20, 12)], 1000).current[0].trackerId;
  const grown = a.update([quad(30, 20, 40)], 1033);
  assert(grown.current[0].trackerId !== first, 'a 3x size jump is not the same card');
});

test('ids are unique across the whole session', () => {
  const a = new QuadAssociator();
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    a.update([quad(10, 10)], 1000 + i * 100);
    a.update([], 1050 + i * 100);              // force a new id each cycle
    for (const t of a.active()) seen.add(t.trackerId);
  }
  a.update([quad(10, 10)], 9000);
  assert(!seen.has(a.active()[0].trackerId), 'a session id was reused');
});

test('reset clears tracking without reusing ids afterwards', () => {
  const a = new QuadAssociator();
  const first = a.update([quad(10, 10)], 1000).current[0].trackerId;
  a.reset();
  assertEqual(a.active().length, 0);
  assert(a.update([quad(10, 10)], 1033).current[0].trackerId !== first);
});
