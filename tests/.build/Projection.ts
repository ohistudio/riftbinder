// Binder — turn a 2D detection into a 3D position. Pure: no runtime, no camera.
//
// A detection is a rectangle in a camera frame. Anchoring UI to the real card
// needs a point in world space, which means recovering DEPTH — and a single
// camera gives no depth on its own.
//
// It does here, because the object has a KNOWN PHYSICAL SIZE. A Riftbound card
// is 63 x 88 mm. Given how tall it appears in pixels, the frame height and the
// camera's vertical field of view, the distance follows from similar triangles:
//
//     apparentAngle = 2 * atan( (h_px / frameH_px) * tan(vFov / 2) )
//     distance      = (realHeight / 2) / tan(apparentAngle / 2)
//
// No depth sensor, no stereo, no ML. The catch is that it depends on the card
// being roughly fronto-parallel — the same assumption the detector already
// makes — and on the detected box being tight, since distance scales inversely
// with apparent size and a loose box reads as "further away".

/** Standard trading card: 63 x 88 mm. */
export const CARD_WIDTH_CM = 6.3;
export const CARD_HEIGHT_CM = 8.8;

export interface CameraIntrinsics {
  frameWidthPx: number;
  frameHeightPx: number;
  /** Vertical field of view, RADIANS. */
  verticalFovRad: number;
}

/** Horizontal FOV implied by the vertical one and the frame's aspect ratio. */
export function horizontalFovRad(intrinsics: CameraIntrinsics): number {
  const aspect = intrinsics.frameWidthPx / intrinsics.frameHeightPx;
  return 2 * Math.atan(Math.tan(intrinsics.verticalFovRad / 2) * aspect);
}

/**
 * Distance to a card of known height that appears `heightPx` tall.
 * Returns null for a degenerate detection rather than an infinity.
 */
export function estimateDistanceCm(
  heightPx: number,
  intrinsics: CameraIntrinsics,
  realHeightCm: number = CARD_HEIGHT_CM,
): number | null {
  if (heightPx <= 0 || intrinsics.frameHeightPx <= 0 || intrinsics.verticalFovRad <= 0) return null;

  const fraction = heightPx / intrinsics.frameHeightPx;
  if (fraction <= 0 || fraction > 1.5) return null;

  const apparentAngle = 2 * Math.atan(fraction * Math.tan(intrinsics.verticalFovRad / 2));
  if (apparentAngle <= 0) return null;

  return (realHeightCm / 2) / Math.tan(apparentAngle / 2);
}

/**
 * Direction from the camera to a pixel, in CAMERA space: +X right, +Y up,
 * -Z forward (Lens Studio's convention). Returned normalised.
 *
 * Pixel coordinates are image-style — x rightward, y DOWNWARD from the top —
 * so y is flipped into the +Y-up camera frame here rather than at every call
 * site, which is where sign errors breed.
 */
export function pixelToCameraDirection(
  xPx: number,
  yPx: number,
  intrinsics: CameraIntrinsics,
): { x: number; y: number; z: number } {
  const halfTanV = Math.tan(intrinsics.verticalFovRad / 2);
  const halfTanH = Math.tan(horizontalFovRad(intrinsics) / 2);

  // -1..1 across the frame, y flipped so up is positive.
  const ndcX = (xPx / intrinsics.frameWidthPx) * 2 - 1;
  const ndcY = 1 - (yPx / intrinsics.frameHeightPx) * 2;

  const x = ndcX * halfTanH;
  const y = ndcY * halfTanV;
  const z = -1;

  const length = Math.sqrt(x * x + y * y + z * z);
  return { x: x / length, y: y / length, z: z / length };
}

export interface DetectedCardPose {
  /** Position in CAMERA space, centimetres. */
  positionCm: { x: number; y: number; z: number };
  distanceCm: number;
  /** How wide the card should be drawn, cm — its real size. */
  widthCm: number;
  heightCm: number;
}

/**
 * Full solve: detection rectangle -> a point in camera space, at the distance
 * implied by its apparent size. The caller transforms by the camera's world
 * matrix to place an anchor.
 */
export function detectionToCameraPose(
  detection: { cx: number; cy: number; height: number },
  intrinsics: CameraIntrinsics,
  realHeightCm: number = CARD_HEIGHT_CM,
): DetectedCardPose | null {
  const distanceCm = estimateDistanceCm(detection.height, intrinsics, realHeightCm);
  if (distanceCm === null) return null;

  const direction = pixelToCameraDirection(detection.cx, detection.cy, intrinsics);
  return {
    positionCm: {
      x: direction.x * distanceCm,
      y: direction.y * distanceCm,
      z: direction.z * distanceCm,
    },
    distanceCm,
    widthCm: realHeightCm * (CARD_WIDTH_CM / CARD_HEIGHT_CM),
    heightCm: realHeightCm,
  };
}
