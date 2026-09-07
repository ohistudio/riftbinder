// Binder — give detected quads stable ids across frames. Pure.
//
// Detection is memoryless: each frame yields a fresh list of rectangles with no
// notion of which was which. This turns that into stable tracker ids, which is
// all the rest of the system needs — TrackerRegistry binds identity to an id,
// and the id only has to survive while the card is visible.
//
// Greedy nearest-centroid association, gated by how far a card could plausibly
// move between frames and by whether it stayed a similar size.
//
// KNOWN LIMIT: if two cards physically cross over each other, greedy matching
// can swap their ids. The consequence is bounded — a swap shows the wrong
// overlay until re-identification — and fixing it properly needs appearance
// matching, which is exactly the per-frame re-identification cost the generic
// tracker design exists to avoid. Documented rather than hidden.

import type { Quad } from './QuadDetect.ts';

export interface TrackedQuad {
  trackerId: string;
  quad: Quad;
  lastSeenAt: number;
}

export interface AssociateOptions {
  /**
   * How far a centroid may move between frames, as a multiple of the quad's
   * mean side. Scaling by size keeps this resolution-independent.
   */
  maxDriftFactor: number;
  /** Reject a match if the box changed size by more than this ratio. */
  maxSizeRatio: number;
}

export const DEFAULT_ASSOCIATE_OPTIONS: AssociateOptions = {
  maxDriftFactor: 0.6,
  maxSizeRatio: 1.8,
};

function meanSide(quad: Quad): number {
  return (quad.width + quad.height) / 2;
}

function sizeRatio(a: Quad, b: Quad): number {
  const sa = meanSide(a);
  const sb = meanSide(b);
  if (sa <= 0 || sb <= 0) return Number.MAX_VALUE;
  return sa > sb ? sa / sb : sb / sa;
}

export class QuadAssociator {
  private tracked: TrackedQuad[] = [];
  private nextId = 1;
  private readonly options: AssociateOptions;

  // Assigned explicitly rather than as a constructor parameter property: Node's
  // type-stripping (which the test harness relies on) cannot handle those.
  constructor(options: AssociateOptions = DEFAULT_ASSOCIATE_OPTIONS) {
    this.options = options;
  }

  /**
   * Match this frame's quads to existing tracks, minting ids for the unmatched.
   * Returns the current tracks; anything not seen this frame is dropped and
   * reported by `lost`.
   */
  update(quads: readonly Quad[], now: number): { current: TrackedQuad[]; lost: string[] } {
    const previous = this.tracked;
    const usedPrevious = new Array<boolean>(previous.length).fill(false);
    const current: TrackedQuad[] = [];

    // Largest first: a big, confident detection should claim its track before a
    // small ambiguous one competes for it.
    const ordered = quads.slice().sort((a, b) => b.area - a.area);

    for (const quad of ordered) {
      let bestIndex = -1;
      let bestDistance = Number.MAX_VALUE;
      const limit = meanSide(quad) * this.options.maxDriftFactor;

      for (let i = 0; i < previous.length; i++) {
        if (usedPrevious[i]) continue;
        const candidate = previous[i].quad;
        if (sizeRatio(quad, candidate) > this.options.maxSizeRatio) continue;

        const dx = quad.cx - candidate.cx;
        const dy = quad.cy - candidate.cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > limit) continue;

        if (distance < bestDistance) { bestDistance = distance; bestIndex = i; }
      }

      if (bestIndex === -1) {
        current.push({ trackerId: `q${this.nextId++}`, quad, lastSeenAt: now });
      } else {
        usedPrevious[bestIndex] = true;
        current.push({ trackerId: previous[bestIndex].trackerId, quad, lastSeenAt: now });
      }
    }

    const lost: string[] = [];
    for (let i = 0; i < previous.length; i++) {
      if (!usedPrevious[i]) lost.push(previous[i].trackerId);
    }

    this.tracked = current;
    return { current, lost };
  }

  active(): TrackedQuad[] {
    return this.tracked.slice();
  }

  reset(): void {
    this.tracked = [];
  }
}
