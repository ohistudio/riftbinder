// Binder — the finished deck, readable. Lens runtime.
//
// Export previously wrote to the Lens Studio log, which is no use at all to
// someone wearing the glasses: the two artifacts BINDER.md calls the point of
// the whole thing were going somewhere the user could not see.
//
// Shows the PULL LIST by default — set, then ascending collector number, which
// is the order you flip through a sorted box. That is the bridge back to the
// physical cards, and the one you want in front of you while standing at the
// shelf. The decklist is a keypress away on the same panel.

import { makePlate, makeLabel } from './ViewUtils';

const LINE_HEIGHT_CM = 2.0;
const VISIBLE_LINES = 16;

export class ExportPanelView {
  private readonly title: Text;
  private readonly lines: Text[] = [];
  private readonly hint: Text;
  private content: string[] = [];
  private scroll = 0;

  constructor(
    private readonly root: SceneObject,
    mesh: RenderMesh,
    materialTemplate: Material,
    font: Font,
    private readonly widthCm: number,
  ) {
    const heightCm = LINE_HEIGHT_CM * (VISIBLE_LINES + 3);
    const backing = makePlate(root, mesh, materialTemplate, widthCm, heightCm);
    // Additive display: a dark backing would not register.
    backing.material.mainPass.baseColor = new vec4(0.16, 0.22, 0.38, 1);

    this.title = makeLabel(root, font, {
      name: 'Export Title', xCm: 0, yCm: heightCm / 2 - LINE_HEIGHT_CM, zCm: 0.05,
      widthCm: widthCm * 0.94, heightCm: LINE_HEIGHT_CM * 1.2,
    });

    const top = heightCm / 2 - LINE_HEIGHT_CM * 2.6;
    for (let i = 0; i < VISIBLE_LINES; i++) {
      const line = makeLabel(root, font, {
        name: `Line ${i}`, xCm: 0, yCm: top - i * LINE_HEIGHT_CM, zCm: 0.05,
        widthCm: widthCm * 0.92, heightCm: LINE_HEIGHT_CM * 0.9,
      });
      line.horizontalAlignment = HorizontalAlignment.Left;
      this.lines.push(line);
    }

    this.hint = makeLabel(root, font, {
      name: 'Export Hint', xCm: 0, yCm: -heightCm / 2 + LINE_HEIGHT_CM, zCm: 0.05,
      widthCm: widthCm * 0.94, heightCm: LINE_HEIGHT_CM,
    });

    root.enabled = false;
  }

  isOpen(): boolean {
    return this.root.enabled;
  }

  show(title: string, content: readonly string[], hint: string): void {
    this.title.text = title;
    this.content = content.slice();
    this.hint.text = hint;
    this.scroll = 0;
    this.root.enabled = true;
    this.paint();
  }

  hide(): void {
    this.root.enabled = false;
  }

  scrollBy(lines: number): void {
    const maxScroll = Math.max(0, this.content.length - VISIBLE_LINES);
    this.scroll = Math.max(0, Math.min(maxScroll, this.scroll + lines));
    this.paint();
  }

  private paint(): void {
    for (let i = 0; i < this.lines.length; i++) {
      const source = this.content[this.scroll + i];
      this.lines[i].text = source === undefined ? '' : source;
    }
    const maxScroll = Math.max(0, this.content.length - VISIBLE_LINES);
    if (maxScroll > 0) {
      this.title.text = `${this.title.text.split('   (')[0]}   (${this.scroll + 1}-`
        + `${Math.min(this.content.length, this.scroll + VISIBLE_LINES)} of ${this.content.length})`;
    }
  }
}
