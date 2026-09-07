// Binder — the focus slot. Lens runtime.
//
// One card at a time, rendered large enough that the official rules text is
// actually readable (BINDER.md § Spatial layout, "Legibility strategy").
//
// Two presentations, and the art one is strongly preferred:
//   • Art available — show the card image. Riftbound art is the FULL card face,
//     so the printed name, cost and rules text come with it. That satisfies the
//     "official English text, verbatim" requirement by literally being the card,
//     and our synthetic labels are hidden so they cannot contradict it.
//   • No art — fall back to the domain colour plus transcribed text.
//
// Art is fetched on demand and never bundled. A slow fetch is not allowed to
// pin the wrong card: every load is checked against the current request id.

import type { Card } from '../Core/Types';
import { domainColor, DomainPalette } from '../Core/DomainColor';
import { aspectOf, FOCUS_ART } from '../Core/CardArt';
import { makePlate, makeLabel, resizePlate } from './ViewUtils';
import { CardArtLoader } from './CardArtLoader';

/** The focus card sits nearer than the panels, so its type keys off that. */
const FOCUS_DISTANCE_CM = 105;

export class FocusSlotView {
  private readonly colourMaterial: Material;
  private readonly colourObject: SceneObject;
  private readonly mesh: RenderMesh;
  private readonly maxHeightCm: number;
  private readonly artObject: SceneObject;
  private readonly artMaterial: Material;
  private readonly titleText: Text;
  private readonly metaText: Text;
  private readonly bodyText: Text;
  /** Bumped on every show() so a late art fetch for a previous card is ignored. */
  private request = 0;

  constructor(
    private readonly root: SceneObject,
    mesh: RenderMesh,
    materialTemplate: Material,
    artMaterialTemplate: Material,
    font: Font,
    heightCm: number,
    private readonly palette: DomainPalette,
    private readonly art: CardArtLoader,
  ) {
    this.mesh = mesh;
    this.maxHeightCm = heightCm;
    // Built portrait; show() resizes to the card's own aspect. A battlefield is
    // landscape, and letterboxing one into a portrait slot leaves a sliver.
    const widthCm = heightCm * 0.716;

    const colour = makePlate(this.root, mesh, materialTemplate, widthCm, heightCm);
    this.colourMaterial = colour.material;
    this.colourObject = colour.object;

    const artPlate = makePlate(this.root, mesh, artMaterialTemplate, widthCm, heightCm, 0.03);
    this.artObject = artPlate.object;
    this.artMaterial = artPlate.material;
    this.artObject.name = 'Art';
    this.artObject.enabled = false;

    this.titleText = makeLabel(this.root, font, {
      name: 'Title', xCm: 0, yCm: heightCm * 0.40, zCm: 0.06,
      widthCm: widthCm * 0.9, heightCm: heightCm * 0.11,
      role: 'Headline1', distanceCm: FOCUS_DISTANCE_CM,
    });
    this.bodyText = makeLabel(this.root, font, {
      name: 'Body', xCm: 0, yCm: -heightCm * 0.10, zCm: 0.06,
      widthCm: widthCm * 0.86, heightCm: heightCm * 0.5,
      role: 'Body', distanceCm: FOCUS_DISTANCE_CM,
    });
    this.bodyText.horizontalOverflow = HorizontalOverflow.Wrap;

    // Meta sits BELOW the card so it survives the art presentation — set,
    // printing id and artist are not printed large on the card itself.
    this.metaText = makeLabel(this.root, font, {
      name: 'Meta', xCm: 0, yCm: -heightCm * 0.60, zCm: 0.06,
      widthCm: widthCm * 1.6, heightCm: heightCm * 0.09,
      role: 'Caption', tone: 'tertiary', distanceCm: FOCUS_DISTANCE_CM,
    });

    this.root.enabled = false;
  }

  /**
   * The card face. The zoomed card has no tap action of its own, so the whole
   * card is the grab target — a 4 cm bar above a 26 cm card was there to be
   * missed.
   */
  grabTarget(): SceneObject { return this.colourObject; }

  show(card: Card): void {
    const request = ++this.request;
    this.root.enabled = true;

    // Fit the card's own aspect, capped so a landscape card does not sprawl.
    const aspect = aspectOf(card);
    let drawHeight = this.maxHeightCm;
    let drawWidth = drawHeight * aspect;
    const maxWidth = this.maxHeightCm * 1.05;
    if (drawWidth > maxWidth) {
      drawWidth = maxWidth;
      drawHeight = drawWidth / aspect;
    }
    resizePlate(this.colourObject, this.mesh, drawWidth, drawHeight);
    resizePlate(this.artObject, this.mesh, drawWidth, drawHeight);
    this.layoutLabels(drawHeight, drawWidth);

    const rgb = domainColor(card.domains, this.palette);
    this.colourMaterial.mainPass.baseColor = new vec4(rgb.r, rgb.g, rgb.b, 1);

    this.titleText.text = card.name;
    this.bodyText.text = card.text;
    this.metaText.text = this.describe(card);

    // Show the transcribed fallback immediately, then swap to art if it arrives.
    this.setArtVisible(false);

    this.art.load(card, FOCUS_ART, (texture) => {
      if (request !== this.request) return;   // a newer card is showing now
      if (texture === null) return;           // keep the text fallback
      this.artMaterial.mainPass.baseTex = texture;
      this.setArtVisible(true);
    });
  }

  clear(): void {
    this.request++;
    this.root.enabled = false;
  }

  /** Keep the labels attached to the card's edges as its size changes. */
  private layoutLabels(heightCm: number, widthCm: number): void {
    this.titleText.getTransform().setLocalPosition(new vec3(0, heightCm * 0.40, 0.06));
    this.bodyText.getTransform().setLocalPosition(new vec3(0, -heightCm * 0.10, 0.06));
    this.metaText.getTransform().setLocalPosition(new vec3(0, -heightCm * 0.60 - 1, 0.06));
    this.metaText.layoutRect = Rect.create(-widthCm * 0.8, widthCm * 0.8, -1.4, 1.4);
  }

  private setArtVisible(visible: boolean): void {
    this.artObject.enabled = visible;
    // The card image already carries name and rules text; showing ours on top
    // would double them up and risk contradicting the printed wording.
    this.titleText.enabled = !visible;
    this.bodyText.enabled = !visible;
  }

  private describe(card: Card): string {
    const stats: string[] = [];
    if (card.energy !== null) stats.push(`${card.energy} energy`);
    if (card.might !== null) stats.push(`${card.might} might`);
    if (card.power !== null) stats.push(`${card.power} power`);

    const domains = card.domains.length > 0 ? card.domains.join(' / ') : 'No domain';
    const kind = card.supertype === null ? card.type : `${card.supertype} ${card.type}`;
    const parts = stats.concat([domains, kind, card.id]);
    if (card.artist !== null) parts.push(`art: ${card.artist}`);
    return parts.join('  ·  ');
  }
}
