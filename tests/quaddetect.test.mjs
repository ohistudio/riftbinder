import { test, assert, assertEqual } from './harness.mjs';
import { detectQuads, otsuThreshold, DEFAULT_DETECT_OPTIONS } from './.build/QuadDetect.ts';

const W = 64, H = 48;

/** Blank frame at a given brightness. */
function frame(background = 40) {
  return new Uint8Array(W * H).fill(background);
}

function fillRect(buf, x, y, w, h, value) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx >= 0 && xx < W && yy >= 0 && yy < H) buf[yy * W + xx] = value;
    }
  }
}

/** A card-proportioned rectangle: 0.716 wide-to-tall. */
function card(buf, x, y, height, value = 220) {
  fillRect(buf, x, y, Math.round(height * 0.716), height, value);
}

function noise(buf, amount = 6) {
  let seed = 12345;
  for (let i = 0; i < buf.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const delta = (seed % (amount * 2 + 1)) - amount;
    buf[i] = Math.max(0, Math.min(255, buf[i] + delta));
  }
}

test('otsu returns a boundary that actually separates the two modes', () => {
  const buf = frame(30);
  card(buf, 10, 8, 30);
  const t = otsuThreshold(buf);
  // The mask uses `> t`, so the correct answer puts background at or below t
  // and card pixels above it. t === 30 is right here, not a failure.
  assert(t >= 30 && t < 220, `threshold ${t} is outside both modes`);
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 30) assert(!(buf[i] > t), 'background classified as foreground');
    if (buf[i] === 220) assert(buf[i] > t, 'card classified as background');
  }
});

test('a single light card on a dark table is found, with sane geometry', () => {
  const buf = frame(30);
  card(buf, 12, 9, 30);                       // 21 x 30 at (12,9)
  const quads = detectQuads(buf, W, H);
  assertEqual(quads.length, 1);
  const q = quads[0];
  assertEqual(q.x, 12);
  assertEqual(q.y, 9);
  assertEqual(q.width, 21);
  assertEqual(q.height, 30);
  assert(Math.abs(q.aspect - 0.7) < 0.05, `aspect ${q.aspect}`);
  assert(q.fill > 0.99, `fill ${q.fill}`);
});

test('a DARK card on a light table is found too — polarity is not assumed', () => {
  const buf = frame(230);
  card(buf, 15, 10, 28, 25);                  // dark card, light background
  const quads = detectQuads(buf, W, H);
  assertEqual(quads.length, 1, 'inverted polarity must not be missed');
  assert(Math.abs(quads[0].aspect - 0.7) < 0.06);
});

test('two cards in frame are detected separately, largest first', () => {
  const buf = frame(30);
  card(buf, 4, 6, 32);
  card(buf, 40, 12, 20);
  const quads = detectQuads(buf, W, H);
  assertEqual(quads.length, 2);
  assert(quads[0].area > quads[1].area, 'results must be largest-first');
  assert(Math.abs(quads[0].cx - quads[1].cx) > 20, 'the two blobs merged');
});

test('sensor noise does not break detection', () => {
  const buf = frame(30);
  card(buf, 12, 9, 30);
  noise(buf, 8);
  const quads = detectQuads(buf, W, H);
  assertEqual(quads.length, 1);
  assert(Math.abs(quads[0].aspect - 0.7) < 0.12);
});

test('a wrong-shaped rectangle is rejected on aspect', () => {
  const buf = frame(30);
  fillRect(buf, 8, 8, 40, 8, 220);            // long thin bar, aspect 5.0
  assertEqual(detectQuads(buf, W, H).length, 0);
});

test('an irregular blob is rejected on fill even at the right size', () => {
  const buf = frame(30);
  // A diagonal streak: spans a card-ish bounding box but fills almost none of it.
  for (let i = 0; i < 28; i++) fillRect(buf, 10 + Math.floor(i * 0.7), 8 + i, 2, 2, 220);
  const quads = detectQuads(buf, W, H);
  assert(quads.length === 0, `a hand-shaped blob was accepted: ${JSON.stringify(quads[0])}`);
});

test('specks and a full-frame wash are both rejected on area', () => {
  const speck = frame(30);
  fillRect(speck, 5, 5, 2, 3, 220);
  assertEqual(detectQuads(speck, W, H).length, 0, 'noise speck accepted');

  const wash = frame(30);
  fillRect(wash, 0, 0, W, H, 220);
  assertEqual(detectQuads(wash, W, H).length, 0, 'whole frame accepted as a card');
});

test('an empty scene detects nothing rather than inventing a card', () => {
  assertEqual(detectQuads(frame(30), W, H).length, 0);
  const noisy = frame(30); noise(noisy, 10);
  assertEqual(detectQuads(noisy, W, H).length, 0);
});

test('malformed input is handled rather than thrown on', () => {
  assertEqual(detectQuads(new Uint8Array(0), 0, 0).length, 0);
  assertEqual(detectQuads(new Uint8Array(10), W, H).length, 0, 'short buffer must not read past the end');
});

test('a large blob does not overflow the stack', () => {
  // Recursive flood fill dies here; the explicit stack must not.
  const buf = frame(30);
  fillRect(buf, 0, 0, W, H - 1, 220);
  detectQuads(buf, W, H);   // rejected on area/aspect, but must not throw
});

// --- textured cards, which is what a real photo actually looks like -----

import { textureMask, gradientMagnitude } from './.build/QuadDetect.ts';

/** A card whose interior is detailed, like real art — NOT a flat bright patch. */
function texturedCard(buf, x, y, height) {
  const w = Math.round(height * 0.716);
  let seed = 99;
  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < w; xx++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      // Full range: dark AND light regions, which is what breaks luma thresholding.
      const value = 20 + (seed % 215);
      const px = x + xx, py = y + yy;
      if (px >= 0 && px < W && py >= 0 && py < H) buf[py * W + px] = value;
    }
  }
}

test('gradient magnitude is high on detail and near zero on a flat surface', () => {
  const flat = frame(60);
  const g1 = gradientMagnitude(flat, W, H);
  let flatSum = 0;
  for (let i = 0; i < g1.length; i++) flatSum += g1[i];
  assertEqual(flatSum, 0, 'a flat frame should have no gradient');

  const detailed = frame(60);
  texturedCard(detailed, 12, 9, 30);
  const g2 = gradientMagnitude(detailed, W, H);
  let detailSum = 0;
  for (let i = 0; i < g2.length; i++) detailSum += g2[i];
  assert(detailSum > 10000, `expected strong gradient, got ${detailSum}`);
});

test('the texture mask closes card detail into one solid region', () => {
  const buf = frame(60);
  texturedCard(buf, 12, 9, 30);
  const mask = textureMask(buf, W, H);
  let on = 0;
  for (let i = 0; i < mask.length; i++) on += mask[i];
  const cardArea = 30 * Math.round(30 * 0.716);
  assert(on > cardArea * 0.5, `mask covered only ${on} of ~${cardArea} card pixels`);
});

test('a TEXTURED card on a flat table is detected — the real-photo case', () => {
  const buf = frame(60);
  texturedCard(buf, 12, 9, 30);
  const quads = detectQuads(buf, W, H);
  assert(quads.length >= 1, 'a detailed card on a flat table must be found');
  const q = quads[0];
  // Allow slack: morphological closing shifts edges by a pixel or two.
  assert(Math.abs(q.x - 12) <= 3, `x ${q.x} far from 12`);
  assert(Math.abs(q.y - 9) <= 3, `y ${q.y} far from 9`);
  assert(Math.abs(q.aspect - 0.716) < 0.25, `aspect ${q.aspect}`);
});

test('a flat table alone still yields nothing', () => {
  const buf = frame(60);
  noise(buf, 3);
  assertEqual(detectQuads(buf, W, H).length, 0, 'flat noise must not become a card');
});

import { fillHoles } from './.build/QuadDetect.ts';

test('hole filling solidifies an enclosed gap but leaves open shapes alone', () => {
  // A ring: enclosed hole in the middle.
  const ring = new Uint8Array(W * H);
  const set = (x, y, v) => { ring[y * W + x] = v; };
  for (let y = 10; y < 30; y++) for (let x = 10; x < 24; x++) set(x, y, 1);
  for (let y = 14; y < 26; y++) for (let x = 14; x < 20; x++) set(x, y, 0);   // hole
  const filled = fillHoles(ring, W, H);
  let holeStillOpen = 0;
  for (let y = 14; y < 26; y++) for (let x = 14; x < 20; x++) if (filled[y * W + x] === 0) holeStillOpen++;
  assertEqual(holeStillOpen, 0, 'an enclosed hole should be filled');

  // A C-shape: its gap reaches the border, so it must NOT be filled.
  const open = new Uint8Array(W * H);
  const setOpen = (x, y) => { open[y * W + x] = 1; };
  for (let y = 10; y < 30; y++) { setOpen(10, y); setOpen(23, y); }
  for (let x = 10; x < 24; x++) setOpen(x, 10);
  const filledOpen = fillHoles(open, W, H);
  assertEqual(filledOpen[20 * W + 16], 0, 'a gap connected to the border must stay open');
});

test('a card whose art has flat regions is still detected', () => {
  // Detailed border, FLAT interior — the case that broke fill before holes
  // were filled. Real card art does exactly this with sky and plain panels.
  const buf = frame(60);
  const x0 = 12, y0 = 9, h = 30, w = Math.round(h * 0.716);
  let seed = 7;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const edge = xx < 2 || xx >= w - 2 || yy < 2 || yy >= h - 2;
      const midBand = yy > h * 0.65;
      let value = 150;                            // flat interior: no gradient
      if (edge || midBand) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        value = 20 + (seed % 215);
      }
      buf[(y0 + yy) * W + (x0 + xx)] = value;
    }
  }
  const quads = detectQuads(buf, W, H);
  assert(quads.length >= 1, 'a card with flat art regions must still be found');
  assert(quads[0].fill >= DEFAULT_DETECT_OPTIONS.minFill,
    `fill ${quads[0].fill} still below threshold after hole filling`);
});
