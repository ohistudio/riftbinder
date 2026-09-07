// Binder — one card tile on a wall. Lens runtime (StudioLib), not Editor API.
//
// Tiles show art region, name, cost and domain colour only. Rules text is never
// abbreviated onto a tile — it goes to the focus slot (BINDER.md § Spatial
// layout, "Legibility strategy").

import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';
import type { Card } from '../Core/Types';
import { domainColor, DomainPalette } from '../Core/DomainColor';
import { TILE_ART, aspectOf } from '../Core/CardArt';
import { makePlate, makeLabel, fitCollider, resizePlate } from './ViewUtils';
import { CardArtLoader } from './CardArtLoader';
import { HoverEffect } from './HoverEffect';

export interface TileDeps {
  mesh: RenderMesh;
  materialTemplate: Material;
  artMaterialTemplate: Material;
  font: Font;
  palette: DomainPalette;
  art: CardArtLoader;
}

export class CardTileView {
  readonly root: SceneObject;
  private readonly material: Material;
  private readonly nameText: Text;
  private readonly costText: Text;
  private readonly interactable: Interactable;
  private readonly hover: HoverEffect;
  private readonly mesh: RenderMesh;
  private readonly plateObject: SceneObject;
  private readonly highlightObject: SceneObject;
  private readonly slotWidthCm: number;
  private readonly slotHeightCm: number;
  private card: Card | null = null;
  private readonly palette: DomainPalette;
  private readonly art: CardArtLoader;
  private readonly artObject: SceneObject;
  private readonly artMaterial: Material;
  /** Bumped on every show() so a late fetch cannot paint a recycled tile. */
  private request = 0;

  constructor(parent: SceneObject, deps: TileDeps, name: string, widthCm: number, heightCm: number) {
    this.palette = deps.palette;
    this.art = deps.art;
    this.mesh = deps.mesh;
    this.slotWidthCm = widthCm;
    this.slotHeightCm = heightCm;
    // Root stays at unit scale so the labels are not distorted; the Plate child
    // carries the tile's size.
    this.root = global.scene.createSceneObject(name);
    this.root.setParent(parent);

    // Sits fractionally behind the tile and is tinted to show hover/selection.
    const highlight = makePlate(this.root, deps.mesh, deps.materialTemplate,
      widthCm + 0.9, heightCm + 0.9, -0.04);
    highlight.object.name = 'Highlight';
    highlight.material.mainPass.baseColor = new vec4(0, 0, 0, 0);
    this.hover = new HoverEffect(this.root, new vec3(1, 1, 1), highlight.material, highlight.object);
    this.highlightObject = highlight.object;

    const plate = makePlate(this.root, deps.mesh, deps.materialTemplate, widthCm, heightCm);
    this.material = plate.material;
    this.plateObject = plate.object;

    // Art region is the top ~60%; name and cost sit in the lower band.
    this.nameText = makeLabel(this.root, deps.font, {
      name: 'Name', xCm: 0, yCm: -heightCm * 0.34, zCm: 0.05,
      widthCm: widthCm * 0.9, heightCm: heightCm * 0.18, role: 'Caption',
    });
    this.costText = makeLabel(this.root, deps.font, {
      name: 'Cost', xCm: -widthCm * 0.34, yCm: heightCm * 0.36, zCm: 0.05,
      widthCm: widthCm * 0.26, heightCm: heightCm * 0.16, role: 'Subheadline',
    });

    const artPlate = makePlate(this.root, deps.mesh, deps.artMaterialTemplate, widthCm, heightCm, 0.03);
    this.artObject = artPlate.object;
    this.artMaterial = artPlate.material;
    this.artObject.name = 'Art';
    this.artObject.enabled = false;

    fitCollider(plate.object);
    this.interactable = plate.object.createComponent(Interactable.getTypeName()) as Interactable;
    this.interactable.targetingMode = 3; // Direct + Indirect: gaze/ray or touch.
  }

  /**
   * Hover is how a tile reaches the focus slot; there is no card dragging.
   * Only hover-ENTER is bound — see CollectionWallView.onFocusRequest for why
   * focus deliberately survives hover-exit.
   */
  onHover(enter: (card: Card) => void): void {
    this.interactable.onHoverEnter.add(() => {
      this.hover.setHovered(true);
      if (this.card !== null) enter(this.card);
    });
    // Visual state only — focus itself stays sticky.
    this.interactable.onHoverExit.add(() => this.hover.setHovered(false));
  }

  /** Mark this tile as the chosen card; persists after you look away. */
  setSelected(selected: boolean): void {
    this.hover.setSelected(selected);
  }

  advance(deltaSeconds: number): void {
    this.hover.advance(deltaSeconds);
  }

  cardId(): string | null {
    return this.card === null ? null : this.card.id;
  }

  onTap(handler: (card: Card) => void): void {
    this.interactable.onTriggerStart.add(() => { if (this.card !== null) handler(this.card); });
  }

  /**
   * Raw press/release, so a container can decide whether a press was a tap or
   * the start of a drag. Tiles cover almost the whole panel, so a scroll that
   * only listened on the background would almost never start.
   */
  onPress(start: (interactor: any) => void, end: () => void): void {
    this.interactable.onTriggerStart.add((event: any) => start(event.interactor));
    this.interactable.onTriggerEnd.add(() => end());
    // A scroll drag almost always releases with the ray off the tile it started
    // on, and SIK sends that as onTriggerEndOutside rather than onTriggerEnd.
    // Without this the drag never terminates and no card is ever picked.
    this.interactable.onTriggerEndOutside.add(() => end());
    this.interactable.onTriggerCanceled.add(() => end());
  }

  currentCard(): Card | null {
    return this.card;
  }

  show(card: Card, count: number, xCm: number, yCm: number): void {
    const request = ++this.request;
    this.card = card;
    this.root.enabled = true;
    this.root.getTransform().setLocalPosition(new vec3(xCm, yCm, 0));

    // Fit the card's own aspect inside the tile slot. Battlefields are
    // landscape, so drawing every card portrait squashes them.
    const aspect = aspectOf(card);
    let drawHeight = this.slotHeightCm;
    let drawWidth = drawHeight * aspect;
    if (drawWidth > this.slotWidthCm) {
      drawWidth = this.slotWidthCm;
      drawHeight = drawWidth / aspect;
    }
    // The colour plate and highlight must follow the art, or a landscape card
    // sits inside a portrait block of domain colour.
    resizePlate(this.artObject, this.mesh, drawWidth, drawHeight);
    resizePlate(this.plateObject, this.mesh, drawWidth, drawHeight);
    resizePlate(this.highlightObject, this.mesh, drawWidth + 0.9, drawHeight + 0.9);
    this.nameText.getTransform().setLocalPosition(
      new vec3(0, -drawHeight * 0.34, 0.05));
    this.costText.getTransform().setLocalPosition(
      new vec3(-drawWidth * 0.34, drawHeight * 0.36, 0.05));

    const rgb = domainColor(card.domains, this.palette);
    this.material.mainPass.baseColor = new vec4(rgb.r, rgb.g, rgb.b, 1);

    // Domain colour and text show immediately; art replaces them when it lands.
    this.nameText.text = count > 1 ? `${card.name} x${count}` : card.name;
    this.costText.text = card.energy === null ? '' : String(card.energy);
    this.setArtVisible(false);
    // A duplicate count has no room on the card face, so keep that one label.
    this.nameText.text = count > 1 ? `x${count}` : '';

    this.art.load(card, TILE_ART, (texture) => {
      if (request !== this.request) return;   // tile was recycled to another card
      if (texture === null) return;           // keep the colour + text fallback
      this.artMaterial.mainPass.baseTex = texture;
      this.setArtVisible(true);
    });
  }

  hide(): void {
    this.request++;
    this.card = null;
    this.root.enabled = false;
  }

  /**
   * The card face already prints its own name and cost, so our labels are
   * hidden once art arrives — leaving them would double up and, at tile size,
   * just smear. Only the duplicate count stays, since the card cannot show it.
   */
  private setArtVisible(visible: boolean): void {
    this.artObject.enabled = visible;
    this.costText.enabled = !visible;
  }

  destroy(): void {
    this.root.destroy();
  }
}
