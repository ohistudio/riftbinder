// Binder — "you are looking at this" and "this one is chosen". Lens runtime.
//
// Without feedback, a gaze-driven interface is guesswork: you cannot tell what
// you are targeting, so you cannot tell whether a tap will do what you meant.
//
// Two distinct states, deliberately kept apart:
//   HOVERED  — transient, follows your gaze, lost the moment you look away.
//   SELECTED — persistent, survives looking away. The focus slot is sticky for
//              exactly this reason: you have to look away from a card to read
//              it, so selection must not evaporate when you do.
//
// Both are animated. A step change reads as a glitch; a fast ease reads as the
// interface responding to you.

const HOVER_SCALE = 1.09;
const SELECTED_SCALE = 1.04;
/** Higher settles faster. ~16 lands in about a sixth of a second. */
const RATE = 16;

const IDLE_GLOW = new vec4(0, 0, 0, 0);
const HOVER_GLOW = new vec4(0.55, 0.95, 1.0, 0.95);
const SELECTED_GLOW = new vec4(0.35, 0.85, 0.55, 0.85);

export class HoverEffect {
  private hovered = false;
  private selected = false;
  private scale = 1;
  private glow: vec4 = IDLE_GLOW;

  /**
   * `highlight` is an optional plate sitting just behind the card; it is tinted
   * rather than toggled so the transition is continuous.
   */
  constructor(
    private readonly target: SceneObject,
    private readonly baseScale: vec3,
    private readonly highlight: Material | null = null,
    /**
     * The highlight's own object. The plate material has blending DISABLED, so
     * an alpha of 0 does not make it invisible — it rendered as a hard pale ring
     * around every card, button and menu row. Hiding the object is the only
     * thing that actually turns it off.
     */
    private readonly highlightObject: SceneObject | null = null,
  ) {
    if (this.highlightObject !== null) this.highlightObject.enabled = false;
  }

  setHovered(hovered: boolean): void { this.hovered = hovered; }
  setSelected(selected: boolean): void { this.selected = selected; }

  isHovered(): boolean { return this.hovered; }

  advance(deltaSeconds: number): void {
    const k = 1 - Math.exp(-RATE * Math.max(0, deltaSeconds));

    const wantedScale = this.hovered ? HOVER_SCALE : this.selected ? SELECTED_SCALE : 1;
    this.scale += (wantedScale - this.scale) * k;
    this.target.getTransform().setLocalScale(new vec3(
      this.baseScale.x * this.scale,
      this.baseScale.y * this.scale,
      this.baseScale.z * this.scale,
    ));

    if (this.highlight === null) return;
    const wantedGlow = this.hovered ? HOVER_GLOW : this.selected ? SELECTED_GLOW : IDLE_GLOW;
    this.glow = new vec4(
      this.glow.x + (wantedGlow.x - this.glow.x) * k,
      this.glow.y + (wantedGlow.y - this.glow.y) * k,
      this.glow.z + (wantedGlow.z - this.glow.z) * k,
      this.glow.w + (wantedGlow.w - this.glow.w) * k,
    );
    this.highlight.mainPass.baseColor = this.glow;
    // Below this the ring is not carrying any visible signal, and leaving it on
    // draws a solid outline the design never asked for.
    if (this.highlightObject !== null) this.highlightObject.enabled = this.glow.w > 0.02;
  }
}
