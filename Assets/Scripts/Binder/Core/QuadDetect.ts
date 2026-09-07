// Binder — find card-shaped regions in a grayscale frame. Pure: no camera, no
// runtime, no model.
//
// BINDER.md § Identification: detection tells you WHERE a card is, never which
// one. That is the whole reason this can be classical CV instead of ML — we
// only need "a card-shaped thing is here", and Gemini reads it once.
//
// Approach, chosen to stay cheap enough for a headset. Three candidate masks
// are built and whichever yields the most card-shaped blobs wins:
//
//   * BRIGHT / DARK — Otsu on luma, both polarities. Works when a card
//     contrasts cleanly with the surface, and is what the synthetic tests use.
//   * TEXTURE — gradient magnitude, closed morphologically. This is the one
//     that works on real photographs: a printed card is DETAILED and a table is
//     FLAT, whereas a card is emphatically not a uniform brightness patch. Card
//     art contains both dark and light regions, so pure luma thresholding
//     shatters the card into fragments and finds nothing. Detail versus
//     flatness is the property that actually separates card from table.
//
// Then: connected components with an explicit stack (recursion overflows on any
// real blob), and rejection by area, aspect and fill. Fill is what separates a
// card from a hand or a shadow — a rectangle fills its bounding box.
//
// Everything runs on a downsampled frame (see Config.scanning.detectWidth) —
// a 64x48 grid is plenty to locate a card held at arm's length and keeps this
// affordable per frame.

export interface Quad {
  /** Bounding box in PIXELS of the frame passed in. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Centroid, pixels. */
  cx: number;
  cy: number;
  /** Filled pixel count. */
  area: number;
  /** width / height of the bounding box. */
  aspect: number;
  /**
   * ROW-SPAN solidity: for each row of the blob, the distance from its leftmost
   * to its rightmost pixel, summed and divided by the bounding-box area.
   *
   * Not raw pixel coverage. The texture mask outlines a card and its detailed
   * regions but leaves flat art (sky, plain panels) unset, so raw coverage of a
   * real card is only ~0.65 and a sane threshold rejects it. Row spans close
   * that gap — an outlined rectangle scores ~1.0 — while a diagonal streak or a
   * hand still scores low, because their rows are individually narrow. It keeps
   * the discriminating power that raw coverage was losing.
   */
  fill: number;
}

export interface DetectOptions {
  /** Smallest blob worth considering, as a fraction of the whole frame. */
  minAreaFraction: number;
  /** Largest, so a wall or table surface is not read as a card. */
  maxAreaFraction: number;
  /** Accepted bounding-box aspect range for a portrait card. */
  minAspect: number;
  maxAspect: number;
  /** How rectangular a blob must be. Rotation lowers this, so do not set it at 1. */
  minFill: number;
}

export const DEFAULT_DETECT_OPTIONS: DetectOptions = {
  minAreaFraction: 0.01,
  maxAreaFraction: 0.6,
  // A Riftbound card is 0.716 w/h. The range allows perspective tilt; a card
  // rotated far past that stops being bounding-box-detectable anyway.
  minAspect: 0.45,
  maxAspect: 1.05,
  // Row-span solidity. Dropping this below ~0.65 lets flat sensor noise
  // through (there is a test for exactly that), so the threshold stays high and
  // the texture mask is made to close properly instead — see closeIterations.
  minFill: 0.66,
};

/** Otsu's method: the threshold that best separates the histogram into two classes. */
export function otsuThreshold(gray: ArrayLike<number>): number {
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) histogram[gray[i] & 0xff]++;

  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let bestVariance = -1;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between = weightBackground * weightForeground
      * (meanBackground - meanForeground) * (meanBackground - meanForeground);

    if (between > bestVariance) { bestVariance = between; best = t; }
  }
  return best;
}

/**
 * Label connected foreground pixels (4-connectivity) and return one Quad per
 * component. Uses an explicit stack — a recursive flood fill overflows on any
 * blob of real size.
 */
function componentsOf(
  mask: Uint8Array,
  width: number,
  height: number,
): Quad[] {
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const quads: Quad[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || visited[start] === 1) continue;

    visited[start] = 1;
    stack.push(start);

    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    // Per-row extents, for row-span solidity.
    const rowMin = new Int32Array(height).fill(width);
    const rowMax = new Int32Array(height).fill(-1);

    while (stack.length > 0) {
      const index = stack.pop() as number;
      const x = index % width;
      const y = (index - x) / width;

      area++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < rowMin[y]) rowMin[y] = x;
      if (x > rowMax[y]) rowMax[y] = x;

      if (x > 0) { const n = index - 1; if (mask[n] === 1 && visited[n] === 0) { visited[n] = 1; stack.push(n); } }
      if (x < width - 1) { const n = index + 1; if (mask[n] === 1 && visited[n] === 0) { visited[n] = 1; stack.push(n); } }
      if (y > 0) { const n = index - width; if (mask[n] === 1 && visited[n] === 0) { visited[n] = 1; stack.push(n); } }
      if (y < height - 1) { const n = index + width; if (mask[n] === 1 && visited[n] === 0) { visited[n] = 1; stack.push(n); } }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;

    let spanArea = 0;
    for (let y = minY; y <= maxY; y++) {
      if (rowMax[y] >= rowMin[y]) spanArea += rowMax[y] - rowMin[y] + 1;
    }

    quads.push({
      x: minX,
      y: minY,
      width: boxWidth,
      height: boxHeight,
      cx: sumX / area,
      cy: sumY / area,
      area,
      aspect: boxWidth / boxHeight,
      fill: spanArea / (boxWidth * boxHeight),
    });
  }

  return quads;
}

/**
 * |dx| + |dy| per pixel. Cheaper than a true Sobel and sufficient here: we only
 * need "is there detail", not an accurate edge orientation.
 */
export function gradientMagnitude(
  gray: ArrayLike<number>,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const dx = Math.abs(gray[i + 1] - gray[i - 1]);
      const dy = Math.abs(gray[i + width] - gray[i - width]);
      const sum = dx + dy;
      out[i] = sum > 255 ? 255 : sum;
    }
  }
  return out;
}

/** Grow the mask by one pixel in 4-connectivity. */
function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] === 1
        || (x > 0 && mask[i - 1] === 1)
        || (x < width - 1 && mask[i + 1] === 1)
        || (y > 0 && mask[i - width] === 1)
        || (y < height - 1 && mask[i + width] === 1)) {
        out[i] = 1;
      }
    }
  }
  return out;
}

/** Shrink the mask by one pixel; border pixels count as empty. */
function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (mask[i] === 1 && mask[i - 1] === 1 && mask[i + 1] === 1
        && mask[i - width] === 1 && mask[i + width] === 1) {
        out[i] = 1;
      }
    }
  }
  return out;
}

/**
 * Fill enclosed holes: flood the background inward from the frame border, then
 * anything still unset is interior and gets filled.
 *
 * This is what keeps `fill` meaningful. Card art contains flat regions (sky,
 * plain backgrounds) that generate no gradient, so the texture mask comes out
 * 50-70% solid over a card and the fill test rejects it. Lowering the threshold
 * instead would also let through the irregular blobs — hands, shadows — that
 * the test exists to reject. A shape whose holes reach the border, like a
 * diagonal streak, is left alone and still fails.
 */
export function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];

  const push = (index: number): void => {
    if (mask[index] === 0 && outside[index] === 0) { outside[index] = 1; stack.push(index); }
  };

  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }

  while (stack.length > 0) {
    const index = stack.pop() as number;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = (mask[i] === 1 || outside[i] === 0) ? 1 : 0;
  return out;
}

/**
 * Edge mask closed into solid regions.
 *
 * Keep `closeIterations` small. Dilation bridges any gap narrower than about
 * twice the iteration count, so an over-eager close welds neighbouring cards
 * into one blob whose aspect then fails — which looks exactly like a detection
 * failure while actually being a merge. Dilation merges the card's interior
 * detail into one blob; the matching erosions pull the boundary back so the
 * bounding box still reflects the card rather than the dilated halo.
 */
export function textureMask(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  closeIterations = 2,
): Uint8Array {
  const gradient = gradientMagnitude(gray, width, height);
  // Otsu on gradient sits high enough to miss a card's softer internal edges,
  // which leaves the blob perforated and tanks its solidity. Backing off to a
  // fraction of it captures those without letting flat surfaces in — the floor
  // is what keeps genuinely flat noise out.
  const threshold = Math.max(6, Math.round(otsuThreshold(gradient) * 0.6));

  let mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = gradient[i] > threshold ? 1 : 0;

  for (let i = 0; i < closeIterations; i++) mask = dilate(mask, width, height);
  for (let i = 0; i < closeIterations; i++) mask = erode(mask, width, height);
  return fillHoles(mask, width, height);
}

/** Why a candidate blob was rejected, or null if it was accepted. */
export function rejectionReason(
  quad: Quad, frameArea: number, options: DetectOptions,
): string | null {
  const fraction = quad.area / frameArea;
  if (fraction < options.minAreaFraction) return `too small (${fraction.toFixed(3)})`;
  if (fraction > options.maxAreaFraction) return `too large (${fraction.toFixed(3)})`;
  if (quad.aspect < options.minAspect) return `too narrow (${quad.aspect.toFixed(2)})`;
  if (quad.aspect > options.maxAspect) return `too wide (${quad.aspect.toFixed(2)})`;
  if (quad.fill < options.minFill) return `not solid enough (${quad.fill.toFixed(2)})`;
  return null;
}

/**
 * Every candidate blob per mask with its verdict. Diagnostic only — this is how
 * you find out WHICH threshold is rejecting a card rather than guessing.
 */
export function describeCandidates(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  options: DetectOptions = DEFAULT_DETECT_OPTIONS,
): { mask: string; quad: Quad; reason: string | null }[] {
  const out: { mask: string; quad: Quad; reason: string | null }[] = [];
  if (width <= 0 || height <= 0 || gray.length < width * height) return out;

  const threshold = otsuThreshold(gray);
  const frameArea = width * height;

  const named: { name: string; mask: Uint8Array }[] = [];
  for (const bright of [true, false]) {
    const mask = new Uint8Array(frameArea);
    for (let i = 0; i < frameArea; i++) {
      mask[i] = (bright ? gray[i] > threshold : gray[i] <= threshold) ? 1 : 0;
    }
    named.push({ name: bright ? 'bright' : 'dark', mask });
  }
  named.push({ name: 'texture', mask: textureMask(gray, width, height) });

  for (const entry of named) {
    for (const quad of componentsOf(entry.mask, width, height)) {
      out.push({ mask: entry.name, quad, reason: rejectionReason(quad, frameArea, options) });
    }
  }
  out.sort((a, b) => b.quad.area - a.quad.area);
  return out;
}

function acceptable(quad: Quad, frameArea: number, options: DetectOptions): boolean {
  return rejectionReason(quad, frameArea, options) === null;
}

/**
 * Detect card-shaped regions. `gray` is row-major, one byte per pixel.
 *
 * Both threshold polarities are tried and the better harvest wins, because a
 * card on a dark mat and a card on a white table are equally likely and picking
 * one polarity up front simply fails half the time.
 */
export function detectQuads(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  options: DetectOptions = DEFAULT_DETECT_OPTIONS,
): Quad[] {
  if (width <= 0 || height <= 0 || gray.length < width * height) return [];

  const threshold = otsuThreshold(gray);
  const frameArea = width * height;

  const masks: Uint8Array[] = [];
  for (const bright of [true, false]) {
    const mask = new Uint8Array(frameArea);
    for (let i = 0; i < frameArea; i++) {
      const on = bright ? gray[i] > threshold : gray[i] <= threshold;
      mask[i] = on ? 1 : 0;
    }
    masks.push(mask);
  }
  masks.push(textureMask(gray, width, height));

  let best: Quad[] = [];
  for (const mask of masks) {
    const found = componentsOf(mask, width, height).filter((q) => acceptable(q, frameArea, options));
    // Prefer whichever mask finds anything; on a tie prefer more candidates,
    // since a missed card is worse than one extra to reject downstream.
    if (found.length > best.length) best = found;
  }

  // Largest first: the card being held up is the one the user means.
  best.sort((a, b) => b.area - a.area);
  return best;
}
