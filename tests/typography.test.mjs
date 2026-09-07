import { test, assert, assertEqual } from './harness.mjs';
import { roleSize, TYPE_SCALE, PANEL_DISTANCE_CM } from './.build/Typography.ts';

test('the scale descends from title to caption', () => {
  const order = ['Title1', 'Title2', 'HeadlineXL', 'Headline1', 'Headline2', 'Subheadline'];
  for (let i = 1; i < order.length; i++) {
    assert(TYPE_SCALE[order[i - 1]].size > TYPE_SCALE[order[i]].size,
      `${order[i - 1]} should be larger than ${order[i]}`);
  }
});

test('sizes scale with viewing distance', () => {
  // The whole point: a panel further away needs larger glyphs to read the same.
  assertEqual(roleSize('Body', 110), 39);
  assert(roleSize('Body', 220) > roleSize('Body', 110));
  assert(roleSize('Body', 55) < roleSize('Body', 110));
});

test('nothing on Binder panels lands under the legibility floor', () => {
  // Every label was size 32 before this existed — below the floor at any
  // distance, which is why the interface read as flat and unreadable.
  const floor = TYPE_SCALE.Caption.size;
  for (const role of Object.keys(TYPE_SCALE)) {
    assert(roleSize(role, PANEL_DISTANCE_CM) >= floor,
      `${role} at panel distance is under the caption floor`);
  }
});
