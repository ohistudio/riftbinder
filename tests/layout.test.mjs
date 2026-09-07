import { test, assert, assertEqual } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { gridSpanCm, gridFitsWall, layoutCollection, layoutDeckByEnergy } from './.build/Layout.ts';
import { Config } from './.build/Config.ts';
import { MemoryCardSource } from './.build/MemoryCardSource.ts';

const { grid, tile, collectionWall, deckWall } = Config.layout;
const entries = (n, startAt = 1000) =>
  Array.from({ length: n }, (_, i) => ({ cardId: `C-${String(i).padStart(4, '0')}`, count: 1, firstScannedAt: startAt + i }));

const overlaps = (a, b) =>
  Math.abs(a.xCm - b.xCm) < (a.widthCm + b.widthCm) / 2 - 1e-9 &&
  Math.abs(a.yCm - b.yCm) < (a.heightCm + b.heightCm) / 2 - 1e-9;

test('the configured grid fits the collection wall face', () => {
  assert(gridFitsWall(grid, tile, collectionWall), JSON.stringify(gridSpanCm(grid, tile)));
});

test('no two tiles on a full page overlap', () => {
  const { placements } = layoutCollection(entries(grid.cols * grid.rows), grid, tile, 0);
  assertEqual(placements.length, grid.cols * grid.rows);
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++)
      assert(!overlaps(placements[i], placements[j]), `${i} overlaps ${j}`);
});

test('every tile stays inside the wall bounds', () => {
  const { placements } = layoutCollection(entries(grid.cols * grid.rows), grid, tile, 0);
  const halfW = collectionWall.widthCm / 2, halfH = collectionWall.heightCm / 2;
  for (const p of placements) {
    assert(Math.abs(p.xCm) + p.widthCm / 2 <= halfW + 1e-9, `x out of bounds: ${p.xCm}`);
    assert(Math.abs(p.yCm) + p.heightCm / 2 <= halfH + 1e-9, `y out of bounds: ${p.yCm}`);
  }
});

test('paging is stable when the collection grows mid-session', () => {
  const before = layoutCollection(entries(50), grid, tile, 0);
  const grown = entries(50).concat(entries(30, 99000));
  const after = layoutCollection(grown, grid, tile, 0);
  for (let i = 0; i < before.placements.length; i++) {
    const b = before.placements[i], a = after.placements[i];
    assertEqual(a.cardId, b.cardId, `tile ${i} changed card`);
    assertEqual(a.xCm, b.xCm, `tile ${i} moved in x`);
    assertEqual(a.yCm, b.yCm, `tile ${i} moved in y`);
  }
});

test('page index is clamped and pageCount is at least one', () => {
  const empty = layoutCollection([], grid, tile, 0);
  assertEqual(empty.pageCount, 1);
  assertEqual(empty.placements.length, 0);
  const perPage = grid.cols * grid.rows;
  const two = layoutCollection(entries(perPage + 1), grid, tile, 99);
  assertEqual(two.pageCount, 2);
  assertEqual(two.page, 1);
  assertEqual(two.placements.length, 1);
});

test('deck wall groups by energy, one column per value, cheapest on the left', () => {
  const source = new MemoryCardSource(CARDS);
  const deck = {
    id: 'd', name: 'test', legendId: 'tst-005-001',
    main: [
      { cardId: 'tst-008-001', count: 3 },  // energy 1
      { cardId: 'tst-002-001', count: 2 },  // energy 2
      { cardId: 'tst-001-001', count: 1 },  // energy 3
      { cardId: 'tst-004-001', count: 1 },  // energy null -> its own column, last
    ],
    runes: [], battlefieldIds: [], updatedAt: 0,
  };
  const { placements, columnCosts } = layoutDeckByEnergy(deck, (id) => source.byId(id), tile, deckWall);
  assertEqual(placements.length, 7);
  assertEqual(JSON.stringify(columnCosts), JSON.stringify([1, 2, 3, null]));
  const xs = columnCosts.map((_, col) => placements.find((p) => p.col === col).xCm);
  for (let i = 1; i < xs.length; i++) assert(xs[i] > xs[i - 1], 'columns must run left to right');
  assertEqual(placements.filter((p) => p.col === 0).length, 3, 'energy-1 column holds all 3 copies');
});

test('deck wall keeps a tall column inside the wall height', () => {
  const source = new MemoryCardSource(CARDS);
  const deck = {
    id: 'd', name: 'tall', legendId: null,
    main: [{ cardId: 'tst-008-001', count: 30 }],
    runes: [], battlefieldIds: [], updatedAt: 0,
  };
  const { placements } = layoutDeckByEnergy(deck, (id) => source.byId(id), tile, deckWall);
  const span = Math.max(...placements.map((p) => Math.abs(p.yCm))) * 2;
  assert(span <= deckWall.heightCm + 1e-9, `column span ${span} exceeds wall`);
});

import { wallPlacement } from './.build/Layout.ts';
import { assertClose } from './harness.mjs';

test('wall placement puts a zero-yaw wall straight ahead on -Z', () => {
  const p = wallPlacement({ distanceCm: 250, yawDeg: 0 }, 0);
  assertClose(p.positionCm.x, 0, 1e-9);
  assertClose(p.positionCm.z, -250, 1e-9);
});

test('the side panels flank the centred collection wall symmetrically', () => {
  const centre = wallPlacement(Config.layout.collectionWall, 0);
  const a = wallPlacement(Config.layout.agentWall, 0);
  const b = wallPlacement(Config.layout.deckWall, 0);
  const dist = (p) => Math.hypot(p.positionCm.x, p.positionCm.z);
  assertClose(dist(centre), Config.layout.collectionWall.distanceCm, 1e-9);
  assertClose(dist(a), Config.layout.agentWall.distanceCm, 1e-9);
  assertClose(dist(b), Config.layout.deckWall.distanceCm, 1e-9);

  // BINDER.md originally specified 40 degrees apart. That assumed a far wider
  // field of view than Specs has (~36 deg). The collection is the thing you
  // work in, so it takes the centre; the agent and the deck are the two panels
  // that serve it and flank at a genuine head-turn. The invariant worth holding
  // is symmetry about the centre panel, not a specific angle.
  assertClose(centre.positionCm.x, 0, 1e-9);
  assertEqual(a.positionCm.x, -b.positionCm.x, 'side panels must be mirrored');
  assertClose(a.positionCm.z, b.positionCm.z, 1e-9);
  assert(a.positionCm.x < 0, 'agent panel is anchored left');
  assert(b.positionCm.x > 0, 'deck wall is anchored right');
  const apart = Math.abs(Config.layout.deckWall.yawDeg - Config.layout.agentWall.yawDeg);
  assert(apart > 60, 'the side panels should require a head turn, not crowd the centre');
});

test('the control block hangs clear of the browse panel, never over it', () => {
  // The controls used to be drawn ON the panel and had to fit inside it. They
  // are now their own surface parented below it, so the invariant changed: what
  // matters is that the block starts BELOW the panel's bottom edge, whatever
  // number of controls a screen happens to show.
  const { grid, tile, collectionWall, controls } = Config.layout;
  const span = gridSpanCm(grid, tile);

  // The busiest screen. Kept as a number rather than imported so a control
  // added without thinking about layout trips this test.
  const busiestScreenButtons = 12;
  const rows = Math.ceil(busiestScreenButtons / controls.columns);
  const top = -span.heightCm / 2 - controls.topOffsetCm;
  const glowCm = 0.5;
  const blockTop = top + (controls.rowHeightCm + glowCm) / 2;
  const blockBottom = top - (rows - 1) * (controls.rowHeightCm + controls.gapCm)
    - (controls.rowHeightCm + glowCm) / 2;

  const gridBottom = -span.heightCm / 2;
  assert(blockTop < gridBottom,
    `controls start at ${blockTop.toFixed(1)}cm, which is on top of the grid `
    + `ending at ${gridBottom.toFixed(1)}cm`);
  assert(blockBottom < blockTop, 'the block grows downward');

  // The heading sits above the grid and must stay on the panel.
  const headingTop = span.heightCm / 2 + 5 + 4;
  assert(headingTop < collectionWall.heightCm / 2,
    `heading reaches ${headingTop.toFixed(1)}cm, past the panel edge`);
});

test('every panel faces the person standing in the middle', () => {
  // The bug this pins down: a panel is rotated by its own bearing, but its
  // front face is local +Z, so rotating it that way turns it AWAY from the
  // user — and the further round the arc it sits, the worse it looks. The
  // walls were ~73 degrees out before this was caught by eye rather than here.
  for (const name of ['collectionWall', 'agentWall', 'deckWall']) {
    const place = wallPlacement(Config.layout[name], 0);
    const yaw = (place.yawDeg * Math.PI) / 180;
    // The panel's front is its local +Z, turned by its yaw.
    const facing = { x: Math.sin(yaw), z: Math.cos(yaw) };
    // The user is at the origin, so this is the way back to them.
    const len = Math.hypot(place.positionCm.x, place.positionCm.z);
    const toUser = { x: -place.positionCm.x / len, z: -place.positionCm.z / len };
    const dot = facing.x * toUser.x + facing.z * toUser.z;
    assertClose(dot, 1, 1e-9);
  }
});

test('the collection grid fits the wall it is drawn on', () => {
  const { grid, tile, collectionWall } = Config.layout;
  assert(gridFitsWall(grid, tile, collectionWall),
    `grid ${JSON.stringify(gridSpanCm(grid, tile))} does not fit ${collectionWall.widthCm}x${collectionWall.heightCm}`);
});

import { domainColor, buildDomainPalette } from './.build/DomainColor.ts';

test('domain colour is deterministic, case-insensitive, and in range', () => {
  const a = domainColor(['Aurora']);
  assertEqual(JSON.stringify(a), JSON.stringify(domainColor(['aurora'])));
  assert(JSON.stringify(a) !== JSON.stringify(domainColor(['Cinder'])), 'domains must differ');
  for (const d of [[], [''], ['Aurora'], ['Cinder'], ['Tide']]) {
    const c = domainColor(d);
    for (const ch of [c.r, c.g, c.b]) assert(ch >= 0 && ch <= 1, `channel out of range: ${ch}`);
  }
});

test('palette spaces domains far apart, which the raw hash does not guarantee', () => {
  const domains = ['Fury', 'Chaos', 'Order', 'Body', 'Calm', 'Mind'];
  const palette = buildDomainPalette(domains.map((d) => [d]).concat([[], []]));
  assertEqual(palette.size, 6, 'one entry per distinct domain, nulls ignored');

  // Every pair must be visibly different. Euclidean distance in rgb is crude
  // but enough to catch the clustering the hash produced on the wall.
  const colors = domains.map((d) => domainColor([d], palette));
  let worst = Infinity;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const a = colors[i], b = colors[j];
      worst = Math.min(worst, Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b));
    }
  }
  assert(worst > 0.25, `closest domain pair is only ${worst.toFixed(3)} apart`);
});

test('palette is stable regardless of the order cards arrive in', () => {
  const a = buildDomainPalette([['Fury'], ['Calm'], ['Mind']]);
  const b = buildDomainPalette([['Mind', 'Fury'], ['Calm'], ['fury']]);
  for (const d of ['Fury', 'Calm', 'Mind']) {
    assertEqual(JSON.stringify(domainColor([d], a)), JSON.stringify(domainColor([d], b)), d);
  }
});

test('an empty domain list stays neutral and an unseen domain still gets a colour', () => {
  const palette = buildDomainPalette([['Fury'], ['Calm']]);
  const neutral = domainColor([], palette);
  assertEqual(JSON.stringify(neutral), JSON.stringify(domainColor(['  '], palette)));
  const unseen = domainColor(['Shurima'], palette);
  for (const ch of [unseen.r, unseen.g, unseen.b]) assert(ch >= 0 && ch <= 1);
});
