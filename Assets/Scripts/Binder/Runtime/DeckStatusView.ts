// Binder — the deck at a glance. Lens runtime.
//
// The deck wall shows the CARDS; this shows the SHAPE: how many, the energy
// curve, and whether it is legal. BINDER.md § Spatial layout wants the curve to
// be the layout rather than a separate chart, and the deck wall does that — but
// the wall is a head-turn away, and while you are talking to the agent you need
// the curve in front of you to know what the deck is missing.
//
// Violations are REPORTED, never enforced (§ Hard IP constraints: no automated
// rules enforcement), and every unverified rule says so on its face.

import type { Card, CardSource, Deck, Violation } from '../Core/Types';
import { mainDeckSize, runeDeckSize, energyCurve } from '../Core/DeckOps';
import { errorCount } from '../Core/Validate';
import { makePlate, makeLabel } from './ViewUtils';

const MAX_BARS = 9;
const BAR_AREA_WIDTH_CM = 26;
const BAR_AREA_HEIGHT_CM = 11;

export class DeckStatusView {
  private readonly title: Text;
  private readonly counts: Text;
  private readonly verdict: Text;
  private readonly detail: Text;
  private readonly bars: { fill: SceneObject; material: Material; label: Text }[] = [];

  constructor(
    private readonly root: SceneObject,
    mesh: RenderMesh,
    materialTemplate: Material,
    font: Font,
    private readonly widthCm: number,
    private readonly heightCm: number,
  ) {
    const backing = makePlate(root, mesh, materialTemplate, widthCm, heightCm);
    // Additive display — see AgentPanelView. Dark backings are invisible.
    backing.material.mainPass.baseColor = new vec4(0.16, 0.22, 0.38, 1);

    this.title = makeLabel(root, font, {
      name: 'Deck Title', xCm: 0, yCm: heightCm * 0.40, zCm: 0.05,
      widthCm: widthCm * 0.9, heightCm: heightCm * 0.11,
    });
    this.counts = makeLabel(root, font, {
      name: 'Deck Counts', xCm: 0, yCm: heightCm * 0.29, zCm: 0.05,
      widthCm: widthCm * 0.9, heightCm: heightCm * 0.08,
    });

    // Curve bars sit in the middle band.
    const slot = BAR_AREA_WIDTH_CM / MAX_BARS;
    for (let i = 0; i < MAX_BARS; i++) {
      const x = -BAR_AREA_WIDTH_CM / 2 + slot * (i + 0.5);
      const holder = global.scene.createSceneObject(`Bar ${i}`);
      holder.setParent(root);
      holder.getTransform().setLocalPosition(new vec3(x, -heightCm * 0.04, 0.06));

      const bar = makePlate(holder, mesh, materialTemplate, slot * 0.66, 1);
      bar.material.mainPass.baseColor = new vec4(0.32, 0.72, 0.95, 1);

      const label = makeLabel(holder, font, {
        name: 'Bar Label', xCm: 0, yCm: -BAR_AREA_HEIGHT_CM / 2 - 1.4, zCm: 0.05,
        widthCm: slot, heightCm: 2,
      });
      this.bars.push({ fill: bar.object, material: bar.material, label });
      holder.enabled = false;
    }

    this.verdict = makeLabel(root, font, {
      name: 'Deck Verdict', xCm: 0, yCm: -heightCm * 0.30, zCm: 0.05,
      widthCm: widthCm * 0.9, heightCm: heightCm * 0.08,
    });
    this.detail = makeLabel(root, font, {
      name: 'Deck Detail', xCm: 0, yCm: -heightCm * 0.41, zCm: 0.05,
      widthCm: widthCm * 0.92, heightCm: heightCm * 0.12,
    });
    this.detail.horizontalOverflow = HorizontalOverflow.Wrap;
  }

  render(deck: Deck, source: CardSource, violations: readonly Violation[]): void {
    const legend = deck.legendId === null ? null : source.byId(deck.legendId);
    this.title.text = legend === null ? deck.name : `${deck.name} · ${legend.name}`;

    const main = mainDeckSize(deck);
    const runes = runeDeckSize(deck);
    this.counts.text = `${main} main · ${runes} runes · ${deck.battlefieldIds.length} battlefields`;

    this.renderCurve(deck, source);

    const errors = errorCount(violations);
    const warnings = violations.length - errors;
    if (violations.length === 0) {
      this.verdict.text = 'No problems found';
      this.detail.text = '';
    } else {
      this.verdict.text = `${errors} error${errors === 1 ? '' : 's'}, `
        + `${warnings} warning${warnings === 1 ? '' : 's'}`;
      // Show the most serious one: an error if there is one, else a warning.
      const worst = violations.find((v) => v.severity === 'error') ?? violations[0];
      this.detail.text = worst.message;
    }
  }

  private renderCurve(deck: Deck, source: CardSource): void {
    const curve = energyCurve(deck, (id) => source.byId(id));
    const tallest = curve.reduce((max, e) => (e.count > max ? e.count : max), 0);

    for (let i = 0; i < this.bars.length; i++) {
      const bar = this.bars[i];
      const entry = curve[i];
      if (entry === undefined || tallest === 0) {
        bar.fill.enabled = false;
        continue;
      }
      bar.fill.enabled = true;

      // Height in proportion to the tallest column, with a visible floor so a
      // single copy still reads as present rather than as nothing.
      const height = Math.max(0.8, (entry.count / tallest) * BAR_AREA_HEIGHT_CM);
      const scale = bar.fill.getTransform().getLocalScale();
      bar.fill.getTransform().setLocalScale(new vec3(scale.x, scale.y, height));
      bar.fill.getTransform().setLocalPosition(new vec3(0, height / 2 - BAR_AREA_HEIGHT_CM / 2, 0));
      bar.label.text = `${entry.energy === null ? '-' : entry.energy}\n${entry.count}`;
    }
  }
}
