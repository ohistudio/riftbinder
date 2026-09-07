// Binder — sound. Lens runtime.
//
// Six sounds, all synthesised locally (tempAssetGen/gen_sfx_binder.js), all
// loaded by requireAsset so the scene carries no wiring to lose. Each sound is
// pooled: one AudioComponent per sound cannot retrigger without cutting itself
// off, and stop()+play() in the same frame is dropped often enough to read as
// broken audio (learned the hard way on VolleyMate).

export class BinderSfx {
  private static readonly TRACKS: { [key: string]: any } = {
    press:   requireAsset('../../../GeneratedSFX/ui_press.wav'),
    pick:    requireAsset('../../../GeneratedSFX/card_pick.wav'),
    shutter: requireAsset('../../../GeneratedSFX/scan_shutter.wav'),
    success: requireAsset('../../../GeneratedSFX/scan_success.wav'),
    fail:    requireAsset('../../../GeneratedSFX/scan_fail.wav'),
    pop:     requireAsset('../../../GeneratedSFX/panel_pop.wav'),
    hover:   requireAsset('../../../GeneratedSFX/hover_tick.wav'),
    slot:    requireAsset('../../../GeneratedSFX/card_slot.wav'),
  };

  private readonly pools: { [key: string]: AudioComponent[] } = {};
  private readonly turn: { [key: string]: number } = {};
  volume = 1;

  constructor() {
    const host = global.scene.createSceneObject('Binder Sfx');
    for (const key in BinderSfx.TRACKS) {
      const list: AudioComponent[] = [];
      const voices = key === 'success' || key === 'fail' ? 1 : key === 'hover' ? 3 : 2;
      try {
        for (let i = 0; i < voices; i++) {
          const a = host.createComponent('Component.AudioComponent') as AudioComponent;
          a.audioTrack = BinderSfx.TRACKS[key];
          list.push(a);
        }
      } catch (e) {
        console.warn(`[Binder][sfx] could not load ${key}: ${e}`);
      }
      this.pools[key] = list;
      this.turn[key] = 0;
    }
    (global as any).binderSfx = this;
  }

  press(): void { this.play('press', 0.9); }
  pick(): void { this.play('pick', 1); }
  shutter(): void { this.play('shutter', 1); }
  success(): void { this.play('success', 0.9); }
  fail(): void { this.play('fail', 0.85); }
  pop(): void { this.play('pop', 0.7); }
  /** A fingertip brushing a card edge. Quiet: it fires on every gaze-hover. */
  hover(): void { this.play('hover', 0.5); }
  /** A card seating into its sleeve — the deck accepting what you gave it. */
  slot(): void { this.play('slot', 0.9); }

  private play(key: string, gain: number): void {
    const list = this.pools[key];
    if (!list || list.length === 0) return;
    const a: any = list[this.turn[key] % list.length];
    this.turn[key] = (this.turn[key] + 1) % list.length;
    try { a.volume = gain * this.volume; a.play(1); } catch (e) { /* */ }
  }
}
