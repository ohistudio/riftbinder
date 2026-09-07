// Binder — the agent's answer, in space. Lens runtime.
//
// SHOWS THE CARDS, not paragraphs about them. The first version listed five
// suggestions as two lines of prose each: perfectly readable on a monitor, a
// wall of text at arm's length on a headset. Reading is the most expensive
// thing you can ask of someone wearing these.
//
// So: one line of summary, the suggested cards as ART, and the reasoning for
// exactly one card — the one you are looking at. Everything else is silent
// until you look at it.
//
// Gaze a card to see why it was suggested; tap it to add it to the deck.

import { Config } from '../Core/Config';
import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';
import type { Card } from '../Core/Types';
import type { AgentPick } from '../Core/AgentPrompt';
import { TILE_ART, aspectOf } from '../Core/CardArt';
import { makePlate, makeLabel, fitCollider, resizePlate } from './ViewUtils';
import { makeCanvas, makeBackPlate, makeObject, makeButton } from './UIKitUtils';
import { CardArtLoader } from './CardArtLoader';
import { HoverEffect } from './HoverEffect';

const MAX_CARDS = 4;
/** Longer than this and the press was someone speaking, not tapping. */
const ASK_HOLD_SECS = 0.35;
const CARD_HEIGHT_CM = 13;
const CARD_WIDTH_CM = CARD_HEIGHT_CM * 0.716;
const GAP_CM = 2.4;

interface Slot {
  root: SceneObject;
  hover: HoverEffect;
  backingObject: SceneObject;
  highlightObject: SceneObject;
  artObject: SceneObject;
  artMaterial: Material;
  fallback: Material;
  caption: Text;
  card: Card | null;
  reason: string;
  request: number;
}

export class AgentPanelView {
  private readonly status: Text;
  private readonly reason: Text;
  private readonly slots: Slot[] = [];
  private onAdd: (card: Card) => void = () => {};
  private onAskHoldStart: (() => void) | null = null;
  private onAskHoldEnd: (() => void) | null = null;
  private onAskHoldCancel: (() => void) | null = null;
  private askHeldAt = 0;
  private onAction: (action: 'ask' | 'about' | 'fits' | 'price') => void = () => {};
  private onFocus: (card: Card) => void = () => {};
  private included: (cardId: string) => boolean = () => false;

  constructor(
    private readonly root: SceneObject,
    private readonly mesh: RenderMesh,
    private readonly materialTemplate: Material,
    private readonly artMaterialTemplate: Material,
    private readonly font: Font,
    private readonly art: CardArtLoader,
    wall?: { widthCm: number; heightCm: number },
  ) {
    // A backing plate is what makes this read as a panel rather than four cards
    // floating in the air. Behind the contents, and far enough back that its
    // collider-free surface never competes with the card art in front of it.
    if (wall !== undefined) {
      makeCanvas(root);
      makeBackPlate(root, wall.widthCm, wall.heightCm);
      // The three things you actually do here, as buttons. Voice still works,
      // but a panel whose only affordance is "talk to it" reads as broken the
      // first time someone opens it in a quiet room.
      // Four now, so the labels shorten to fit the panel rather than the row
      // spilling off it.
      const rowY = -wall.heightCm / 2 + 3.4;
      // Ask is press-and-HOLD to speak — the mic, not the keyboard. A tap is
      // still the old canned question, so a mis-press does nothing surprising.
      const ask = makeObject(root, 'Ask Row', new vec3(-20.5, rowY, 0.4));
      const askButton = makeButton(ask, font, 'Ask', 11, 4.6, () => {});
      askButton.onTriggerDown.add(() => {
        this.askHeldAt = getTime();
        if (this.onAskHoldStart !== null) this.onAskHoldStart();
      });
      askButton.onTriggerUp.add(() => {
        if (getTime() - this.askHeldAt < ASK_HOLD_SECS) {
          if (this.onAskHoldCancel !== null) this.onAskHoldCancel();
          this.onAction('ask');
          return;
        }
        if (this.onAskHoldEnd !== null) this.onAskHoldEnd();
      });
      const about = makeObject(root, 'About Row', new vec3(-7.5, rowY, 0.4));
      makeButton(about, font, 'About', 13, 4.6, () => this.onAction('about'));
      const fits = makeObject(root, 'Fits Row', new vec3(6, rowY, 0.4));
      makeButton(fits, font, 'Fits deck?', 13, 4.6, () => this.onAction('fits'));
      const price = makeObject(root, 'Price Row', new vec3(19, rowY, 0.4));
      makeButton(price, font, 'Price', 11, 4.6, () => this.onAction('price'));
    }

    this.status = makeLabel(root, font, {
      name: 'Agent Status', xCm: 0, yCm: CARD_HEIGHT_CM * 0.86, zCm: 0.05,
      widthCm: (CARD_WIDTH_CM + GAP_CM) * MAX_CARDS, heightCm: 5.5, role: 'Subheadline',
    });
    this.status.horizontalOverflow = HorizontalOverflow.Wrap;
    // Shrink, not Overflow. A long answer wrapped past the bottom of its box
    // and ran straight over the card slots below it; shrinking keeps it inside
    // the space it was given however much the model says.
    this.status.verticalOverflow = VerticalOverflow.Shrink;
    this.status.text = 'Ask for a card.';

    const pitch = CARD_WIDTH_CM + GAP_CM;
    const originX = -((MAX_CARDS - 1) * pitch) / 2;
    for (let i = 0; i < MAX_CARDS; i++) {
      this.slots.push(this.buildSlot(originX + i * pitch));
    }

    // One reason at a time, for the card under attention.
    // Raised and shortened. At -11.96 with a 5.5 cm box this ran from -9.2 down
    // to -14.7, and the button row starts at -12.3 — so the reason line and the
    // buttons were drawing through each other. It now stops above them.
    // -13.5 with a 6 cm box spans -10.5 to -16.5: below the card labels, which
    // end at -9.6, and above the buttons, which start at -19.3 on a 50 cm panel.
    this.reason = makeLabel(root, font, {
      name: 'Agent Reason', xCm: 0, yCm: -13.5, zCm: 0.05,
      widthCm: (CARD_WIDTH_CM + GAP_CM) * MAX_CARDS, heightCm: 6,
      // Body at full opacity, not Caption at 72%. This line carries the
      // assistant's actual answer — the thing you asked for — and it was set in
      // the smallest role the scale has, dimmed, in a 3 cm box.
      role: 'Body',
    });
    this.reason.horizontalOverflow = HorizontalOverflow.Wrap;
    this.reason.verticalOverflow = VerticalOverflow.Shrink;
    this.reason.text = '';
  }

  /** Mark suggestions that are already in the deck. */
  setIncluded(isIncluded: (cardId: string) => boolean): void {
    this.included = isIncluded;
    for (const slot of this.slots) {
      slot.hover.setSelected(slot.card !== null && isIncluded(slot.card.id));
    }
  }

  advance(deltaSeconds: number): void {
    for (const slot of this.slots) slot.hover.advance(deltaSeconds);
  }

  onAddRequest(handler: (card: Card) => void): void { this.onAdd = handler; }

  /** Hold Ask to talk: open the mic on the way down, send on the way up. */
  onAskHold(start: () => void, end: () => void, cancel: () => void): void {
    this.onAskHoldStart = start;
    this.onAskHoldEnd = end;
    this.onAskHoldCancel = cancel;
  }
  onActionRequest(handler: (action: 'ask' | 'about' | 'fits' | 'price') => void): void {
    this.onAction = handler;
  }
  onFocusRequest(handler: (card: Card) => void): void { this.onFocus = handler; }

  setStatus(message: string): void {
    this.status.text = message;
  }

  /** Body text under the cards — used for card facts as well as pick reasons. */
  setReason(message: string): void {
    this.reason.text = message;
  }

  show(summary: string, picks: readonly AgentPick[], byId: (cardId: string) => Card | null): void {
    this.status.text = summary === '' ? 'Suggestions' : summary;
    this.reason.text = '';

    // Resolve the cards first: slot sizing depends on how many there are.
    const resolved: { card: Card; reason: string }[] = [];
    for (const pick of picks) {
      if (resolved.length >= MAX_CARDS) break;
      const card = byId(pick.cardId);
      if (card !== null) resolved.push({ card, reason: pick.reason });
    }

    const pitch = ((CARD_WIDTH_CM + GAP_CM) * MAX_CARDS) / Math.max(1, resolved.length);
    const originX = -((resolved.length - 1) * pitch) / 2;

    resolved.forEach((entry, i) => {
      const slot = this.slots[i];
      slot.root.getTransform().setLocalPosition(new vec3(originX + i * pitch, 0, 0));
      this.fillSlot(slot, entry.card, entry.reason, resolved.length);
    });
    for (let i = resolved.length; i < this.slots.length; i++) this.clearSlot(this.slots[i]);
  }

  clearPicks(): void {
    for (const slot of this.slots) this.clearSlot(slot);
    this.reason.text = '';
  }

  private fillSlot(slot: Slot, card: Card, reason: string, usedCount: number): void {
    const request = ++slot.request;
    slot.card = card;
    slot.reason = reason;
    slot.root.enabled = true;
    slot.hover.setSelected(this.included(card.id));
    slot.hover.setHovered(false);

    // Battlefields are landscape; drawing them in a portrait slot leaves a
    // letterboxed sliver. Fit each card to its own aspect, and share out the
    // row's full width — with three landscape cards there is far more room than
    // a portrait slot pitch allows, and sizing to that pitch wastes it.
    const rowWidth = (CARD_WIDTH_CM + GAP_CM) * MAX_CARDS;
    const budget = rowWidth / Math.max(1, usedCount) - GAP_CM * 0.6;

    const aspect = aspectOf(card);
    let drawHeight = CARD_HEIGHT_CM;
    let drawWidth = drawHeight * aspect;
    if (drawWidth > budget) {
      drawWidth = budget;
      drawHeight = drawWidth / aspect;
    }
    resizePlate(slot.backingObject, this.mesh, drawWidth, drawHeight);
    resizePlate(slot.highlightObject, this.mesh, drawWidth + 1.2, drawHeight + 1.2);
    resizePlate(slot.artObject, this.mesh, drawWidth, drawHeight);
    slot.caption.getTransform().setLocalPosition(
      new vec3(0, -drawHeight * 0.5 - 1.8, 0.05));
    const energy = card.energy === null ? '-' : String(card.energy);
    slot.caption.text = `${card.name}   ${energy}`;

    // Art replaces the placeholder when it lands; a stale fetch cannot paint a
    // slot that has since been reused.
    slot.artObject.enabled = false;
    this.art.load(card, TILE_ART, (texture) => {
      if (request !== slot.request || texture === null) return;
      slot.artMaterial.mainPass.baseTex = texture;
      slot.artObject.enabled = true;
    });
  }

  private clearSlot(slot: Slot): void {
    slot.request++;
    slot.hover.setHovered(false);
    slot.hover.setSelected(false);
    slot.card = null;
    slot.reason = '';
    slot.root.enabled = false;
  }

  private buildSlot(xCm: number): Slot {
    const root = global.scene.createSceneObject('Suggestion');
    root.setParent(this.root);
    root.getTransform().setLocalPosition(new vec3(xCm, 0, 0));

    // A slightly larger plate behind the card, tinted to show hover/selection.
    const highlight = makePlate(root, this.mesh, this.materialTemplate,
      CARD_WIDTH_CM + 1.4, CARD_HEIGHT_CM + 1.4, -0.04);
    highlight.object.name = 'Highlight';
    highlight.material.mainPass.baseColor = new vec4(0, 0, 0, 0);

    const backing = makePlate(root, this.mesh, this.materialTemplate, CARD_WIDTH_CM, CARD_HEIGHT_CM);
    // Specs is an ADDITIVE display: it adds light and never subtracts it, so a
    // dark fill darkens nothing and only hazes the view.
    backing.material.mainPass.baseColor = new vec4(0.18, 0.26, 0.44, 1);

    const artPlate = makePlate(root, this.mesh, this.artMaterialTemplate,
      CARD_WIDTH_CM, CARD_HEIGHT_CM, 0.04);
    artPlate.object.name = 'Art';
    artPlate.object.enabled = false;

    const caption = makeLabel(root, this.font, {
      name: 'Caption', xCm: 0, yCm: -CARD_HEIGHT_CM * 0.62, zCm: 0.05,
      widthCm: CARD_WIDTH_CM + GAP_CM * 0.8, heightCm: 2.6,
    });

    fitCollider(backing.object);
    const interactable = backing.object.createComponent(Interactable.getTypeName()) as Interactable;
    interactable.targetingMode = 3;

    const slot: Slot = {
      root,
      hover: new HoverEffect(root, new vec3(1, 1, 1), highlight.material, highlight.object),
      backingObject: backing.object,
      highlightObject: highlight.object,
      artObject: artPlate.object, artMaterial: artPlate.material,
      fallback: backing.material, caption, card: null, reason: '', request: 0,
    };

    interactable.onHoverEnter.add(() => {
      slot.hover.setHovered(true);
      if (slot.card === null) return;
      this.reason.text = slot.reason;
      this.onFocus(slot.card);
    });
    // Hover-exit clears the VISUAL state only. Focus is deliberately sticky —
    // you have to look away from a card to read it in the focus slot.
    interactable.onHoverExit.add(() => slot.hover.setHovered(false));
    interactable.onTriggerStart.add(() => {
      if (slot.card !== null) this.onAdd(slot.card);
    });

    root.enabled = false;
    return slot;
  }
}
