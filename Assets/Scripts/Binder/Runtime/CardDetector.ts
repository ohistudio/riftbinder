// Binder — the detection loop. Lens runtime.
//
// Ties the pure pieces together:
//   FrameGrabber -> detectQuads -> QuadAssociator -> TrackerRegistry -> vision
//
// Runs on a throttle, not every frame. Detection is cheap but not free, and a
// card being held still does not need re-detecting at 60 Hz. Identification is
// throttled harder still: it costs a network round trip, so a tracker must be
// stable for a moment before it earns one.

import type { Quad } from '../Core/QuadDetect';
import type { TrackedQuad } from '../Core/QuadTracking';
import { detectQuads, DEFAULT_DETECT_OPTIONS } from '../Core/QuadDetect';
import { QuadAssociator } from '../Core/QuadTracking';
import { TrackerRegistry } from '../Core/Trackers';
import { FrameGrabber } from './FrameGrabber';

const TAG = '[Binder][detect]';

export interface DetectionView {
  trackerId: string;
  quad: Quad;
  /** Null until vision has identified it. */
  cardId: string | null;
}

export class CardDetector {
  private readonly grabber: FrameGrabber;
  private readonly associator = new QuadAssociator();
  readonly trackers = new TrackerRegistry();
  private lastRunAt = 0;

  constructor(detectWidth: number, detectHeight: number) {
    this.grabber = new FrameGrabber(detectWidth, detectHeight);
  }

  /**
   * Run one detection pass over `source`. Returns the tracked quads, or null if
   * the frame was not readable. Safe to call every frame — it self-throttles.
   */
  step(source: Texture, now: number, intervalMs: number): DetectionView[] | null {
    if (now - this.lastRunAt < intervalMs) return null;
    const gray = this.grabber.grab(source);
    if (gray === null) return null;
    return this.stepGray(gray, now, 0);
  }

  /**
   * Detect from a grayscale buffer already in hand. The demo uses this to skip
   * the texture copy entirely, which is also what makes it a fair test of the
   * detector rather than of the pixel plumbing.
   */
  stepGray(gray: ArrayLike<number>, now: number, intervalMs: number): DetectionView[] | null {
    if (now - this.lastRunAt < intervalMs) return null;
    this.lastRunAt = now;

    const quads = detectQuads(gray, this.grabber.width, this.grabber.height, DEFAULT_DETECT_OPTIONS);
    const association = this.associator.update(quads, now);

    this.trackers.observeAll(association.current.map((t) => t.trackerId), now);
    // A tracker that stopped being seen loses its binding immediately; the
    // registry's own TTL then reaps it.
    for (const lostId of association.lost) this.trackers.bind(lostId, null, now);

    return association.current.map((tracked) => ({
      trackerId: tracked.trackerId,
      quad: tracked.quad,
      cardId: this.trackers.cardFor(tracked.trackerId),
    }));
  }

  /**
   * Trackers that have been stable long enough to be worth a vision call.
   * `identify` receives a cropped texture; call `bind` with the result.
   */
  pending(now: number, minAgeMs: number): string[] {
    return this.trackers.pendingIdentification(now, minAgeMs).map((b) => b.trackerId);
  }

  cropFor(trackerId: string): Texture | null {
    const tracked = this.associator.active().find((t) => t.trackerId === trackerId);
    if (tracked === undefined) return null;
    const q = tracked.quad;
    return this.grabber.cropToTexture(q.x, q.y, q.width, q.height);
  }

  markIdentifying(trackerId: string): void {
    this.trackers.markIdentifying(trackerId);
  }

  bind(trackerId: string, cardId: string | null, now: number): void {
    this.trackers.bind(trackerId, cardId, now);
    if (cardId !== null) console.log(`${TAG} ${trackerId} -> ${cardId}`);
  }

  expire(now: number, ttlMs: number): string[] {
    return this.trackers.expire(now, ttlMs);
  }

  /** Normalised (0..1) centre of a quad, for projecting into world space. */
  normalisedCentre(quad: Quad): { x: number; y: number } {
    return this.grabber.toNormalised(quad.cx, quad.cy);
  }
}
