// Binder — motion that says "the interface heard you". Lens runtime.
//
// One kind of movement, used everywhere: a pop — scale up through a small
// overshoot and settle. A panel that pops into place reads as having ARRIVED;
// one that snaps on reads as a glitch. Same grammar as HoverEffect, so the
// whole Lens moves with one accent.
//
// Pure bookkeeping: the app's existing UpdateEvent calls advance(dt), each
// animation eases its object, finished ones drop out of the list.

interface Pop {
  object: SceneObject;
  base: vec3;
  t: number;
  duration: number;
}

interface Pulse {
  object: SceneObject;
  base: vec3;
  t: number;
  duration: number;
  depth: number;
}

export class Juice {
  private readonly pops: Pop[] = [];
  private readonly pulses: Pulse[] = [];

  /**
   * A quick squash-and-recover — the thing you pressed pressing back.
   *
   * Different from popIn on purpose: a pop says "this has arrived", a pulse
   * says "that registered". It dips to (1 - depth) and eases back to rest over
   * `duration`, short enough to finish before the finger has lifted. Pulsing
   * an object already mid-pulse restarts from its resting size, so a rapid
   * double-tap does not shrink it twice over.
   */
  pulse(object: SceneObject | null, depth = 0.07, duration = 0.16): void {
    if (object === null) return;
    let base = object.getTransform().getLocalScale();
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      if (this.pulses[i].object === object) {
        base = this.pulses[i].base;
        this.pulses.splice(i, 1);
      }
    }
    this.pulses.push({ object, base, t: 0, duration, depth });
  }

  /**
   * Pop `object` in from 60% scale with a 6% overshoot. Captures the current
   * scale as the resting size, so popping an already-popping object is safe —
   * the earlier entry is retired first rather than compounding.
   */
  popIn(object: SceneObject | null, duration = 0.28): void {
    if (object === null) return;
    let base = object.getTransform().getLocalScale();
    for (let i = this.pops.length - 1; i >= 0; i--) {
      if (this.pops[i].object === object) {
        base = this.pops[i].base;                 // resting size, not mid-pop size
        this.pops.splice(i, 1);
      }
    }
    object.getTransform().setLocalScale(base.uniformScale(0.6));
    this.pops.push({ object, base, t: 0, duration });
  }

  advance(dt: number): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i];
      pulse.t += dt;
      const k = Math.min(1, pulse.t / pulse.duration);
      // One half-sine dip: fast in, soft out, back exactly where it started.
      const dip = Math.sin(k * Math.PI) * pulse.depth;
      try {
        pulse.object.getTransform().setLocalScale(pulse.base.uniformScale(1 - dip));
      } catch (err) { this.pulses.splice(i, 1); continue; }
      if (k >= 1) {
        try { pulse.object.getTransform().setLocalScale(pulse.base); } catch (err) { /* */ }
        this.pulses.splice(i, 1);
      }
    }

    for (let i = this.pops.length - 1; i >= 0; i--) {
      const pop = this.pops[i];
      pop.t += dt;
      const k = Math.min(1, pop.t / pop.duration);
      // Back-out easing: overshoots to ~1.06 around k=0.7, settles at 1.
      const s = 1.70158;
      const e = 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
      try { pop.object.getTransform().setLocalScale(pop.base.uniformScale(0.6 + e * 0.4)); } catch (err) { this.pops.splice(i, 1); continue; }
      if (k >= 1) {
        try { pop.object.getTransform().setLocalScale(pop.base); } catch (err) { /* */ }
        this.pops.splice(i, 1);
      }
    }
  }
}
