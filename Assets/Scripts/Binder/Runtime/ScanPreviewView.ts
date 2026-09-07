// Binder — what the scanner actually saw. Lens runtime.
//
// Exists because "read name=null" is unfalsifiable from the log alone: it looks
// identical whether the camera handed over a black frame, the card was out of
// shot, or the model genuinely could not read the print. This panel shows the
// FRAME THAT WAS SENT, boxed where a card was found, with the model's own words
// underneath — so a failed scan says which of those three it was.

import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';
import type { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate';
import type { Card } from '../Core/Types';
import type { Quad } from '../Core/QuadDetect';
import { makePlate, makeLabel, resizePlate } from './ViewUtils';
import { makeCanvas, makeBackPlate, makeObject, makeText, makeButton } from './UIKitUtils';

const FRAME_WIDTH_CM = 34;
/** The picture sits above centre, leaving the lower third for the readout. */
// Raised from 5. The answer line under the picture grew when it started
// carrying the assistant's replies, and the picture was sitting low enough that
// the text ran straight through the buttons.
const FRAME_CENTRE_Y_CM = 8;
/** Height of the action row at the foot of the panel. */
const BUTTON_HEIGHT_CM = 5;
/** Longer than this and the press was someone speaking, not tapping. */
const HOLD_THRESHOLD_SECS = 0.35;

export class ScanPreviewView {
  private readonly frameObject: SceneObject;
  private readonly frameMaterial: Material;
  private readonly boxObject: SceneObject;
  private readonly caption: Text;
  private readonly reply: Text;
  private frameHeightCm: number;
  private readonly captionObject: SceneObject;
  private readonly replyObject: SceneObject;
  private readonly boxLabel: Text;
  private readonly boxLabelObject: SceneObject;
  private readonly boxEdges: SceneObject[] = [];
  private addButtonObject: SceneObject | null = null;
  private onAddCard: ((card: Card) => void) | null = null;
  private onAskCard: ((card: Card) => void) | null = null;
  private askButtonObject: SceneObject | null = null;
  private onPriceCard: ((card: Card) => void) | null = null;
  private priceButtonObject: SceneObject | null = null;
  private onAskHoldStart: (() => void) | null = null;
  private onAskHoldEnd: (() => void) | null = null;
  private onAskHoldCancel: (() => void) | null = null;
  private heldAt = 0;
  private addLabel: Text | null = null;
  /** The card this scan is offering, if it matched one. */
  private pending: Card | null = null;
  private readonly plate: BackPlate;

  constructor(
    private readonly root: SceneObject,
    private readonly mesh: RenderMesh,
    materialTemplate: Material,
    artMaterialTemplate: Material,
    font: Font | null,
    widthCm: number,
    heightCm: number,
  ) {
    makeCanvas(root);
    this.plate = makeBackPlate(root, widthCm, heightCm);

    // A starting guess only. show() resizes to the frame's real aspect — the
    // Specs camera is not 4:3 (it came back 360x408), and guessing would put
    // the detection box off the card.
    this.frameHeightCm = FRAME_WIDTH_CM;

    const content = makeObject(root, 'Content', new vec3(0, 0, 0.6));

    makeText(makeObject(content, 'Title', new vec3(0, heightCm / 2 - 4.5, 0.2)),
      font, 'Text', 'Your scan', { role: 'Subheadline', widthCm: widthCm - 4 });

    const frame = makePlate(content, mesh, artMaterialTemplate,
      FRAME_WIDTH_CM, this.frameHeightCm, 0.1);
    frame.object.name = 'Frame';
    frame.object.getTransform().setLocalPosition(new vec3(0, FRAME_CENTRE_Y_CM, 0.1));
    this.frameObject = frame.object;
    this.frameMaterial = frame.material;

    // FOUR thin bars, not one filled quad. The plate material has blending
    // disabled, so a single translucent-looking rectangle is in fact opaque and
    // hides the very card it is meant to point at.
    this.boxObject = makeObject(content, 'Detection Box', new vec3(0, 0, 0.25));
    for (let i = 0; i < 4; i++) {
      const edge = makePlate(this.boxObject, mesh, materialTemplate, 1, 1, 0);
      edge.object.name = `Edge ${i}`;
      edge.material.mainPass.baseColor = new vec4(0.30, 0.95, 0.55, 1);
      this.boxEdges.push(edge.object);
    }
    this.boxObject.enabled = false;

    // The verdict ON the picture, pinned to the box, so the identification and
    // the thing identified are read in one glance rather than two.
    this.boxLabelObject = makeObject(content, 'Box Label', new vec3(0, 0, 0.35));
    this.boxLabel = makeText(this.boxLabelObject, font, 'Text', '',
      { role: 'Subheadline', widthCm: 26, heightCm: 3 });
    this.boxLabelObject.enabled = false;

    // Keep the WRAPPERS: makeText builds its Text on a child of what it is
    // given, so moving the returned Text moves it relative to the wrapper and
    // any later reposition lands twice.
    this.captionObject = makeObject(content, 'Caption', new vec3(0, 0, 0.2));
    this.caption = makeText(this.captionObject, font, 'Text', '',
      { role: 'Headline2', widthCm: widthCm - 4 });

    this.replyObject = makeObject(content, 'Reply', new vec3(0, 0, 0.2));
    // Bigger and brighter than it started. This line began as a place to put a
    // one-line failure message, in the smallest role at reduced opacity — but
    // it now carries the assistant's answers and price estimates, which are the
    // reason you pressed anything, and at Caption/secondary they were too small
    // to read at arm's length.
    this.reply = makeText(this.replyObject, font, 'Text', '',
      { role: 'Subheadline', widthCm: widthCm - 5, heightCm: 9, wrap: true });
    // An assistant answer is longer than a one-line failure message, so it
    // shrinks to fit rather than running off the bottom of the panel.
    this.reply.verticalOverflow = VerticalOverflow.Shrink;

    this.layoutText();

    // The scan PROPOSES; you commit. Adding straight from a scan meant a
    // misread quietly put the wrong card in your deck, and the first you knew
    // of it was finding it there later.
    // Four across, so the labels are short. "Add" rather than "Add to deck":
    // the panel is about one card and the button sits under its picture, so
    // there is nothing else it could be adding.
    const rowY = -heightCm / 2 + 4;
    const BUTTON_W = 9.4;
    this.addButtonObject = makeObject(content, 'Add Row', new vec3(-15.2, rowY, 0.4));
    makeButton(this.addButtonObject, font, 'Add', BUTTON_W, BUTTON_HEIGHT_CM, () => {
      const card = this.pending;
      if (card !== null && this.onAddCard !== null) this.onAddCard(card);
      this.hide();
    });
    this.addButtonObject.enabled = false;
    this.addLabel = firstTextIn(this.addButtonObject);

    // Ask about the card that was just read, without hunting for it in the
    // grid first. The scan already knows which card it is; making you find it
    // again to ask a question about it was busywork.
    // Press and HOLD to talk, tap to get the card's facts.
    //
    // A tap alone could only ever ask one fixed question. Holding opens the mic
    // so the question can be your own — the same press-and-hold the controls
    // bar uses, so the gesture means the same thing in both places.
    this.askButtonObject = makeObject(content, 'Ask Row', new vec3(-5.1, rowY, 0.4));
    const askButton = makeButton(
      this.askButtonObject, font, 'Ask', BUTTON_W, BUTTON_HEIGHT_CM, () => {});
    askButton.onTriggerDown.add(() => {
      this.heldAt = getTime();
      if (this.onAskHoldStart !== null) this.onAskHoldStart();
    });
    askButton.onTriggerUp.add(() => {
      const held = getTime() - this.heldAt;
      // A quick tap is not an attempt to speak. Below this it is the old
      // behaviour — tell me about this card — and above it, what you said.
      if (held < HOLD_THRESHOLD_SECS) {
        if (this.onAskHoldCancel !== null) this.onAskHoldCancel();
        const card = this.pending;
        if (card !== null && this.onAskCard !== null) this.onAskCard(card);
        return;
      }
      if (this.onAskHoldEnd !== null) this.onAskHoldEnd();
    });
    this.askButtonObject.enabled = false;

    // Price is asked for, not shown automatically: it is a model ESTIMATE and
    // a paid round trip, so it happens when somebody wants it rather than on
    // every scan. The answer lands on the assistant panel, labelled as an
    // estimate — see Core/CardQuery.ts.
    this.priceButtonObject = makeObject(content, 'Price Row', new vec3(5.1, rowY, 0.4));
    makeButton(this.priceButtonObject, font, 'Price', BUTTON_W, BUTTON_HEIGHT_CM, () => {
      const card = this.pending;
      if (card !== null && this.onPriceCard !== null) this.onPriceCard(card);
    });
    this.priceButtonObject.enabled = false;

    const closeObject = makeObject(content, 'Close Row', new vec3(15.2, rowY, 0.4));
    makeButton(closeObject, font, 'Close', BUTTON_W, BUTTON_HEIGHT_CM, () => this.hide());

    root.enabled = false;
  }

  /** Fires when the user accepts the scanned card. */
  onAdd(handler: (card: Card) => void): void { this.onAddCard = handler; }

  /** Fires when the user wants the assistant to talk about the scanned card. */
  onAsk(handler: (card: Card) => void): void { this.onAskCard = handler; }

  /**
   * Put a line of assistant text on the scan panel itself.
   *
   * Ask and Price used to answer only on the assistant panel, which is a
   * head-turn away and behind this one — so pressing them looked like nothing
   * happening at all. The answer belongs where the button was.
   */
  setNote(text: string): void {
    this.reply.text = text;
  }

  /**
   * What the accept button says.
   *
   * At the start of a build you are CHOOSING a legend, a champion, a
   * battlefield — one of a kind, not another copy — and "Add" reads as though
   * it stacks. Only once those are settled is it adding to the deck proper.
   */
  setAddLabel(text: string): void {
    if (this.addLabel !== null) this.addLabel.text = text;
  }

  /** Is the panel currently showing? Used to decide where an answer goes. */
  isOpen(): boolean {
    return this.root.enabled;
  }

  /**
   * Press-and-hold on Ask: open the mic on the way down, send on the way up.
   *
   * `cancel` fires when the press was too short to be speech, so the mic can be
   * closed again without anything being sent.
   */
  onAskHold(start: () => void, end: () => void, cancel: () => void): void {
    this.onAskHoldStart = start;
    this.onAskHoldEnd = end;
    this.onAskHoldCancel = cancel;
  }

  /** Fires when the user wants a price estimate for the scanned card. */
  onPrice(handler: (card: Card) => void): void { this.onPriceCard = handler; }

  /** Lay the four bars out as the edges of a boxW x boxH rectangle. */
  private drawOutline(boxW: number, boxH: number): void {
    const t = 0.6;   // bar thickness
    const spec: { w: number; h: number; x: number; y: number }[] = [
      { w: boxW, h: t, x: 0, y: boxH / 2 },
      { w: boxW, h: t, x: 0, y: -boxH / 2 },
      { w: t, h: boxH, x: -boxW / 2, y: 0 },
      { w: t, h: boxH, x: boxW / 2, y: 0 },
    ];
    for (let i = 0; i < this.boxEdges.length; i++) {
      resizePlate(this.boxEdges[i], this.mesh, spec[i].w, spec[i].h);
      this.boxEdges[i].getTransform().setLocalPosition(new vec3(spec[i].x, spec[i].y, 0));
    }
  }

  /** Sit the readout under the frame, whatever aspect the frame turned out to be. */
  private layoutText(): void {
    const bottom = FRAME_CENTRE_Y_CM - this.frameHeightCm / 2;
    this.captionObject.getTransform().setLocalPosition(new vec3(0, bottom - 3.5, 0.2));
    // Sized and placed to STOP above the button row. With the frame centred at
    // 8 the picture bottoms out near -11, the caption takes the next 3.5, and
    // the buttons start at -27.5 — so the answer gets the band between.
    this.replyObject.getTransform().setLocalPosition(new vec3(0, bottom - 11, 0.2));
  }

  /**
   * Tapping the panel dismisses it. Bound inside onInitialized because the
   * BackPlate creates its Interactable as part of its own start-up — asking
   * for it any earlier finds nothing and binds silently to no one.
   */
  onDismiss(handler: () => void): void {
    this.plate.onInitialized.add(() => {
      const grab = this.root.getComponent(Interactable.getTypeName()) as Interactable;
      if (grab === null) return;
      // SIK's Interactable, not UIKit's Element: the events are onTrigger*.
      grab.onTriggerEnd.add(() => handler());
      grab.onTriggerEndOutside.add(() => handler());
    });
  }

  hide(): void { this.root.enabled = false; }

  /**
   * Show the frame that was sent, the box where a card was found, and what the
   * model made of it.
   */
  show(frame: Texture | null, quad: Quad | null, framePx: { w: number; h: number },
       caption: string, modelReply: string, card: Card | null = null): void {
    this.root.enabled = true;
    this.pending = card;
    // Nothing to add when the read did not resolve to a real card.
    if (this.addButtonObject !== null) this.addButtonObject.enabled = card !== null;
    if (this.askButtonObject !== null) this.askButtonObject.enabled = card !== null;
    if (this.priceButtonObject !== null) this.priceButtonObject.enabled = card !== null;

    if (frame !== null) {
      const w = frame.getWidth();
      const h = frame.getHeight();
      // Fit the real frame aspect, so the box lands where the card is.
      this.frameHeightCm = w > 0 ? (FRAME_WIDTH_CM * h) / w : FRAME_WIDTH_CM;
      this.frameMaterial.mainPass.baseTex = frame;
      resizePlate(this.frameObject, this.mesh, FRAME_WIDTH_CM, this.frameHeightCm);
      this.layoutText();
    }

    this.caption.text = caption;
    // The model's raw JSON is DEBUG, not a result. It is still logged, but a
    // wall of braces under the picture told you nothing you could act on and
    // buried the one line that mattered — which card this is. The line is kept
    // for the case where there is no answer, because "nothing" needs saying.
    this.reply.text = card !== null
      ? '' : modelReply.length > 0
        ? 'Read something, but it matched no card in the catalogue.'
        : 'The model returned nothing at all.';

    if (quad === null || framePx.w <= 0 || framePx.h <= 0) {
      // No box does NOT mean no verdict. The detector looks for a card-shaped
      // region against a background and finds nothing when the card fills the
      // frame — exactly the framing that reads best. Hiding the label with the
      // box meant the identification vanished precisely when it was right.
      this.boxObject.enabled = false;
      this.boxLabelObject.enabled = true;
      this.boxLabel.text = caption;
      this.boxLabelObject.getTransform().setLocalPosition(
        new vec3(0, FRAME_CENTRE_Y_CM + this.frameHeightCm / 2 - 2.5, 0.35));
      return;
    }

    // Detector pixels -> panel centimetres. Y flips: pixel rows count down from
    // the top, centimetres count up from the middle.
    const scaleX = FRAME_WIDTH_CM / framePx.w;
    const scaleY = this.frameHeightCm / framePx.h;
    const boxW = Math.max(1, quad.width * scaleX);
    const boxH = Math.max(1, quad.height * scaleY);
    const cx = (quad.cx - framePx.w / 2) * scaleX;
    const cy = -(quad.cy - framePx.h / 2) * scaleY + FRAME_CENTRE_Y_CM;

    this.boxObject.enabled = true;
    this.boxObject.getTransform().setLocalPosition(new vec3(cx, cy, 0.25));
    this.drawOutline(boxW, boxH);

    // Sat just above the box, and pushed back inside the picture when the box
    // is near the top edge so the label never floats off the frame.
    const labelY = Math.min(
      cy + boxH / 2 + 2, FRAME_CENTRE_Y_CM + this.frameHeightCm / 2 - 2.5);
    this.boxLabelObject.enabled = true;
    this.boxLabel.text = caption;
    this.boxLabelObject.getTransform().setLocalPosition(new vec3(cx, labelY, 0.35));
  }
}

/** The first Text anywhere under an object — a button's label lives in a child. */
function firstTextIn(object: SceneObject): Text | null {
  const own = object.getComponent('Component.Text') as Text | null;
  if (own !== null) return own;
  for (let i = 0; i < object.getChildrenCount(); i++) {
    const found = firstTextIn(object.getChild(i));
    if (found !== null) return found;
  }
  return null;
}
