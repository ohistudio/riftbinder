import { test, assert, assertEqual, assertClose } from './harness.mjs';
import { estimateDistanceCm, pixelToCameraDirection, detectionToCameraPose,
         horizontalFovRad, CARD_HEIGHT_CM } from './.build/Projection.ts';

// Roughly the Specs camera: 36.6 degrees vertical over a 4:3 frame.
const CAM = { frameWidthPx: 96, frameHeightPx: 72, verticalFovRad: 0.6386 };

test('horizontal fov exceeds vertical on a wider-than-tall frame', () => {
  assert(horizontalFovRad(CAM) > CAM.verticalFovRad);
  const square = { ...CAM, frameWidthPx: 72 };
  assertClose(horizontalFovRad(square), CAM.verticalFovRad, 1e-9);
});

test('a card filling half the frame height sits at a plausible arm\'s length', () => {
  const distance = estimateDistanceCm(CAM.frameHeightPx / 2, CAM);
  // Half the frame at ~37 degrees vertical -> roughly 27 cm for an 8.8 cm card.
  assert(distance > 20 && distance < 35, `got ${distance}`);
});

test('distance is inversely proportional to apparent size', () => {
  const near = estimateDistanceCm(40, CAM);
  const far = estimateDistanceCm(20, CAM);
  // Halving the apparent height roughly doubles the distance.
  assertClose(far / near, 2, 0.05);
});

test('the solve round-trips: place a card, and the maths recovers its distance', () => {
  // A card 8.8 cm tall at 60 cm subtends this many pixels:
  const trueDistance = 60;
  const angle = 2 * Math.atan((CARD_HEIGHT_CM / 2) / trueDistance);
  const heightPx = (Math.tan(angle / 2) / Math.tan(CAM.verticalFovRad / 2)) * CAM.frameHeightPx;

  const recovered = estimateDistanceCm(heightPx, CAM);
  assertClose(recovered, trueDistance, 0.5, 'distance should round-trip');
});

test('degenerate detections yield null rather than infinity', () => {
  assertEqual(estimateDistanceCm(0, CAM), null);
  assertEqual(estimateDistanceCm(-5, CAM), null);
  assertEqual(estimateDistanceCm(500, CAM), null, 'a box larger than the frame is not a card');
});

test('the frame centre maps to straight ahead, which is -Z', () => {
  const dir = pixelToCameraDirection(CAM.frameWidthPx / 2, CAM.frameHeightPx / 2, CAM);
  assertClose(dir.x, 0, 1e-9);
  assertClose(dir.y, 0, 1e-9);
  assertClose(dir.z, -1, 1e-9);
});

test('image y runs DOWN while camera y runs UP', () => {
  const top = pixelToCameraDirection(CAM.frameWidthPx / 2, 0, CAM);
  const bottom = pixelToCameraDirection(CAM.frameWidthPx / 2, CAM.frameHeightPx, CAM);
  assert(top.y > 0, 'the top of the image must be above the axis');
  assert(bottom.y < 0, 'the bottom of the image must be below it');
  assertClose(top.y, -bottom.y, 1e-9);
});

test('right of frame is +X, left is -X', () => {
  const right = pixelToCameraDirection(CAM.frameWidthPx, CAM.frameHeightPx / 2, CAM);
  const left = pixelToCameraDirection(0, CAM.frameHeightPx / 2, CAM);
  assert(right.x > 0 && left.x < 0);
  assertClose(right.x, -left.x, 1e-9);
});

test('direction is always unit length', () => {
  for (const [x, y] of [[0, 0], [96, 72], [48, 36], [10, 60]]) {
    const d = pixelToCameraDirection(x, y, CAM);
    assertClose(Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z), 1, 1e-9);
  }
});

test('a centred detection produces a pose straight ahead at the right depth', () => {
  const pose = detectionToCameraPose({ cx: 48, cy: 36, height: 24 }, CAM);
  assert(pose !== null);
  assertClose(pose.positionCm.x, 0, 1e-6);
  assertClose(pose.positionCm.y, 0, 1e-6);
  assert(pose.positionCm.z < 0, 'forward is -Z');
  assertClose(Math.abs(pose.positionCm.z), pose.distanceCm, 1e-6);
  assertClose(pose.heightCm, CARD_HEIGHT_CM, 1e-9);
  assertClose(pose.widthCm / pose.heightCm, 6.3 / 8.8, 1e-9);
});

test('an off-centre detection is offset in the matching direction', () => {
  const right = detectionToCameraPose({ cx: 80, cy: 36, height: 24 }, CAM);
  const upper = detectionToCameraPose({ cx: 48, cy: 10, height: 24 }, CAM);
  assert(right.positionCm.x > 0, 'right of frame should be +X');
  assert(upper.positionCm.y > 0, 'top of frame should be +Y');
});

test('a degenerate detection yields no pose', () => {
  assertEqual(detectionToCameraPose({ cx: 48, cy: 36, height: 0 }, CAM), null);
});
