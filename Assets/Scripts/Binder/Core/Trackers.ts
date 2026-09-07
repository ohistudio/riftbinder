// Binder — tracker identity binding. Pure, no runtime, no camera.
//
// The insight that makes card-anchored UI tractable: for TRACKING purposes it
// does not matter which card a detected rectangle is. The detector only has to
// produce a stable, unique id while the card stays visible. Identity is
// established ONCE, by Gemini, and bound to that id.
//
// This removes frame-to-frame re-identification entirely — the expensive,
// fragile part of every "detect real cards" design. Losing a tracker (occluded,
// out of frame) simply drops the binding and the next sighting re-identifies.
//
// What feeds this is deliberately abstract. A quad detector, a marker, or a
// hand-assigned id all satisfy the contract: give each visible card a stable
// string while you can see it. NOTE that the detector itself is NOT implemented
// — this registry is the half that can be written and tested without a device.

export interface TrackerBinding {
  trackerId: string;
  /** Null while the tracker has been seen but not yet identified. */
  cardId: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  /** True once identification is in flight, so it is not requested twice. */
  identifying: boolean;
}

export class TrackerRegistry {
  private readonly bindings = new Map<string, TrackerBinding>();

  /** Report a tracker as visible this frame. Creates it if new. */
  observe(trackerId: string, now: number): TrackerBinding {
    const existing = this.bindings.get(trackerId);
    if (existing !== undefined) {
      existing.lastSeenAt = now;
      return existing;
    }
    const created: TrackerBinding = {
      trackerId, cardId: null, firstSeenAt: now, lastSeenAt: now, identifying: false,
    };
    this.bindings.set(trackerId, created);
    return created;
  }

  observeAll(trackerIds: readonly string[], now: number): void {
    for (const id of trackerIds) this.observe(id, now);
  }

  /**
   * Trackers that are visible, unidentified, and not already being identified.
   * `minAgeMs` avoids firing a vision call at a detection that flickered for
   * one frame — identification costs a network round trip.
   */
  pendingIdentification(now: number, minAgeMs: number): TrackerBinding[] {
    const out: TrackerBinding[] = [];
    this.bindings.forEach((binding) => {
      if (binding.cardId === null && !binding.identifying && now - binding.firstSeenAt >= minAgeMs) {
        out.push(binding);
      }
    });
    return out;
  }

  markIdentifying(trackerId: string): void {
    const binding = this.bindings.get(trackerId);
    if (binding !== undefined) binding.identifying = true;
  }

  /** Identification came back. A null cardId means it could not be read. */
  bind(trackerId: string, cardId: string | null, now: number): void {
    const binding = this.bindings.get(trackerId);
    if (binding === undefined) return;   // expired while the call was in flight
    binding.cardId = cardId;
    binding.identifying = false;
    binding.lastSeenAt = now;
  }

  cardFor(trackerId: string): string | null {
    const binding = this.bindings.get(trackerId);
    return binding === undefined ? null : binding.cardId;
  }

  get(trackerId: string): TrackerBinding | null {
    return this.bindings.get(trackerId) ?? null;
  }

  /**
   * Drop trackers not seen recently and return their ids so the renderer can
   * tear down their UI. The binding goes with them: re-appearing means
   * re-identifying, which is the trade that buys us no re-identification cost
   * per frame.
   */
  expire(now: number, ttlMs: number): string[] {
    const dropped: string[] = [];
    this.bindings.forEach((binding, id) => {
      if (now - binding.lastSeenAt > ttlMs) dropped.push(id);
    });
    for (const id of dropped) this.bindings.delete(id);
    return dropped;
  }

  /** Trackers currently held, identified or not. */
  active(): TrackerBinding[] {
    const out: TrackerBinding[] = [];
    this.bindings.forEach((b) => out.push(b));
    return out;
  }

  size(): number {
    return this.bindings.size;
  }
}
