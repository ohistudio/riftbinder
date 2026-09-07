// Binder — a rehearsed scan, driven by LEAF. Lens runtime, PREVIEW ONLY.
//
// Verifying the scanner has been the weak point all along: it depended on where
// the preview camera happened to be pointing, so a run either photographed a
// card by luck or photographed the carpet. This scenario removes the luck. The
// simulated hand picks up the card already sitting in the scene, holds it up,
// presses Scan card, and then CHECKS WHAT CAME BACK — so the same picture is
// taken every time and a misread fails the run instead of passing quietly.
//
// It is a test fixture, not product code: nothing here runs unless a LEAF
// scenario is started.

import { Scenario } from 'Leaf.lspkg/Scenarios/scenario/Scenario';
import type { ScenarioConfig } from 'Leaf.lspkg/Scenarios/scenario/ScenarioConfig';
import { IKBodyInteractor } from 'Leaf.lspkg/Interactors/interactor/ik/IKBodyInteractor';
import { DefaultLeafInteractor } from 'Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor';
import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';

const TAG = '[Binder][leaf]';

/**
 * The card in the scene the hand picks up. A real object placed by hand rather
 * than one spawned here — the point is to rehearse against the actual scene,
 * and a prop built by the test only ever proves the test can build a prop.
 */
const CARD_OBJECT_NAME = 'RengarCard';

/**
 * What the scan must come back with. A run reading anything else FAILS.
 *
 * RengarCard is the SFD 025 printing — "Pouncing" — not the UNL 120 one. Worth
 * stating here because the two are indistinguishable by name alone, which is
 * the whole reason the set code matters.
 */
const EXPECT_IN_RESULT = 'Pouncing';

/** How long to let Gemini answer before calling the run a failure. */
const RESULT_TIMEOUT_SECS = 30;

/**
 * How far in front of the eye the card is held, cm, and how far below the eye
 * line. Further is more natural to look at; too far and the collector number
 * stops resolving. The assertion at the end of the run is what says whether a
 * given distance still reads, so this can be tuned honestly.
 */
// RengarCard is about 20 cm across — roughly three times a real card — so the
// distance is scaled to match. A real card is ~9 cm tall and reads naturally at
// arm's length, about a 1:4 size-to-distance ratio; 20 cm wants ~80.
const HOLD_DISTANCE_CM = 80;
// Tuned against the captured frame, not the scene view: at -14 the card sat up
// near the top edge of what the camera sent, which is not where anyone holds a
// card they are looking at. The vertical span the capture sees at this distance
// is only about 55 cm, so a small change in this number moves the card a long
// way up or down the picture.
const HOLD_DROP_CM = -31;

@component
export class ScanRehearsal extends Scenario {
  private card: SceneObject | null = null;
  private restorePosition: vec3 | null = null;
  private restoreRotation: quat | null = null;

  async run(_config?: ScenarioConfig): Promise<void> {
    const camera = this.findCamera();
    if (camera === null) throw new Error('no camera in the scene');

    this.card = this.findByName(CARD_OBJECT_NAME);
    if (this.card === null) {
      throw new Error(`no "${CARD_OBJECT_NAME}" in the scene to pick up`);
    }
    // Put it back where it was found. A fixture that rearranges the scene makes
    // the next run different from this one.
    const transform = this.card.getTransform();
    this.restorePosition = transform.getWorldPosition();
    this.restoreRotation = transform.getWorldRotation();

    try {
      await this.rehearse(camera);
    } finally {
      this.putCardBack();
    }
  }

  private async rehearse(camera: Camera): Promise<void> {
    // With a fallback: the IK arm has a real reach, and the panels sit wherever
    // the wearer was looking when the layout was placed. When the arm cannot
    // converge on a target the body routes the press through a plain SIK
    // interactor instead of failing the run — calling hand.trigger() directly
    // skips that routing, which is why an out-of-reach panel aborted the run.
    const body = new IKBodyInteractor({ fallback: new DefaultLeafInteractor() });
    const hand = body.right;
    console.log(`${TAG} IK body interactor ready`);

    // Picked up: the card tracks the wrist while the hand moves.
    const follow = this.createEvent('UpdateEvent');
    follow.bind(() => this.followHand(hand));

    // Scan card only exists on the deck and cards screens, so open one the way
    // a person would rather than reaching into the app to set the mode.
    if (this.findInteractable('Scan card') === null) {
      const buildDeck = this.findInteractable('Build a deck');
      if (buildDeck === null) throw new Error('could not find the main menu');
      console.log(`${TAG} opening the deck screen`);
      await body.trigger(buildDeck);
      await this.wait(1.5);
    }

    const scan = this.findInteractable('Scan card');
    if (scan === null) throw new Error('could not find the Scan card button');

    // Plant the card BEFORE the press. The capture fires a fraction of a second
    // after the button, whereas trigger() only resolves once the whole arm
    // animation has finished — planting afterwards was always too late and the
    // frame went to Gemini with the card still down by the hip.
    follow.enabled = false;
    this.holdCard(camera, HOLD_DISTANCE_CM, HOLD_DROP_CM);

    console.log(`${TAG} pressing Scan card, holding ${CARD_OBJECT_NAME}`);
    await body.trigger(scan);

    // Wait for the ANSWER, not for a fixed guess at how long Gemini takes. A
    // nine-second wait passed runs whose reply arrived five seconds later, and
    // one run that never got a reply at all.
    const result = await this.waitForResult();
    console.log(`${TAG} scan result: ${result}`);
    if (result.indexOf(EXPECT_IN_RESULT) === -1) {
      throw new Error(`expected "${EXPECT_IN_RESULT}", scan said "${result}"`);
    }
    // Look at what came back. Pressing Ask aims the head at the scan window —
    // the IK aims at whatever it triggers — so the run ends with the panel in
    // view instead of off to one side, and it exercises the Ask button on the
    // way. The panel stays open; Ask does not dismiss it.
    // Scoped to the scan panel. A bare search for "Ask" also matches the
    // assistant's own Ask button and the controls bar's "Hold to ask", and the
    // first of those the walk happens to reach is the one the head aims at —
    // which is how the run ended up staring at the wrong panel.
    const scanPanel = this.findByName('Scan Preview');
    const ask = scanPanel === null ? null : this.searchLabel(scanPanel, 'Ask');
    if (ask !== null) {
      console.log(`${TAG} looking at the scan, asking about the card`);
      await body.trigger(ask);
      await this.wait(1.0);
    }

    console.log(`${TAG} rehearsal complete — read the card correctly`);
  }

  /** Poll the scan panel's caption until it says something. */
  private async waitForResult(): Promise<string> {
    const deadline = getTime() + RESULT_TIMEOUT_SECS;
    while (getTime() < deadline) {
      const caption = this.findCaption();
      if (caption !== null && caption.length > 0) return caption;
      await this.wait(0.5);
    }
    throw new Error(`no scan result within ${RESULT_TIMEOUT_SECS}s`);
  }

  /** The verdict line on the scan panel, which is the app's own conclusion. */
  private findCaption(): string | null {
    const panel = this.findByName('Scan Preview');
    if (panel === null || !panel.enabled) return null;
    const caption = this.findDescendant(panel, 'Caption');
    if (caption === null) return null;
    const text = this.firstText(caption);
    return text === null ? null : text.text;
  }

  private firstText(object: SceneObject): Text | null {
    const own = object.getComponent('Component.Text') as Text | null;
    if (own !== null) return own;
    for (let i = 0; i < object.getChildrenCount(); i++) {
      const found = this.firstText(object.getChild(i));
      if (found !== null) return found;
    }
    return null;
  }

  /** Sit the card just in front of the wrist, face out, as if held. */
  private followHand(hand: { currentWristPose: { position: vec3; rotation: quat } | undefined }): void {
    if (this.card === null) return;
    const pose = hand.currentWristPose;
    if (pose === undefined) return;
    const out = pose.rotation.multiplyVec3(new vec3(0, 0, -1));
    const transform = this.card.getTransform();
    transform.setWorldPosition(pose.position.add(out.uniformScale(7)));
    transform.setWorldRotation(pose.rotation);
  }

  /** Hold the card up in front of the camera, square on. */
  private holdCard(camera: Camera, distanceCm: number, dropCm: number): void {
    if (this.card === null) return;
    const eye = camera.getSceneObject().getTransform();
    const rotation = eye.getWorldRotation();
    // Transform.forward points BACKWARDS in this runtime, so the look direction
    // is derived by rotating -Z rather than trusting it.
    const look = rotation.multiplyVec3(new vec3(0, 0, -1));
    const up = rotation.multiplyVec3(new vec3(0, 1, 0));

    const card = this.card.getTransform();
    card.setWorldPosition(eye.getWorldPosition()
      .add(look.uniformScale(distanceCm))
      .add(up.uniformScale(dropCm)));
    // Square to the camera: the collector number is the smallest print on the
    // card and the first thing lost to a foreshortened angle.
    card.setWorldRotation(rotation);
  }

  private putCardBack(): void {
    if (this.card === null || this.restorePosition === null || this.restoreRotation === null) return;
    const transform = this.card.getTransform();
    transform.setWorldPosition(this.restorePosition);
    transform.setWorldRotation(this.restoreRotation);
  }

  private findCamera(): Camera | null {
    const count = global.scene.getRootObjectsCount();
    for (let i = 0; i < count; i++) {
      const found = this.searchCamera(global.scene.getRootObject(i));
      if (found !== null) return found;
    }
    return null;
  }

  private searchCamera(object: SceneObject): Camera | null {
    const camera = object.getComponent('Component.Camera') as Camera | null;
    // Skip Binder's own capture camera: it renders to a texture, and aiming the
    // rehearsal at it would put the card outside the wearer's view.
    if (camera !== null && object.name.indexOf('Scan Camera') === -1) return camera;
    for (let i = 0; i < object.getChildrenCount(); i++) {
      const found = this.searchCamera(object.getChild(i));
      if (found !== null) return found;
    }
    return null;
  }

  private findByName(name: string): SceneObject | null {
    const count = global.scene.getRootObjectsCount();
    for (let i = 0; i < count; i++) {
      const root = global.scene.getRootObject(i);
      if (root.name === name) return root;
      const found = this.findDescendant(root, name);
      if (found !== null) return found;
    }
    return null;
  }

  private findDescendant(object: SceneObject, name: string): SceneObject | null {
    for (let i = 0; i < object.getChildrenCount(); i++) {
      const child = object.getChild(i);
      if (child.name === name) return child;
      const found = this.findDescendant(child, name);
      if (found !== null) return found;
    }
    return null;
  }

  /**
   * Find a control by the words printed on it.
   *
   * Not by object name: after the UIKit rebuild a menu row is a SceneObject
   * called "Item" with its label in a grandchild Text, so names identify
   * nothing. The text a person would read is the stable handle.
   */
  private findInteractable(label: string): Interactable | null {
    const count = global.scene.getRootObjectsCount();
    for (let i = 0; i < count; i++) {
      const found = this.searchLabel(global.scene.getRootObject(i), label);
      if (found !== null) return found;
    }
    return null;
  }

  private searchLabel(object: SceneObject, label: string): Interactable | null {
    if (object.enabled) {
      const text = object.getComponent('Component.Text') as Text | null;
      if (text !== null && text.text.indexOf(label) !== -1) {
        const owner = this.interactableAbove(object);
        if (owner !== null) return owner;
      }
    }
    for (let i = 0; i < object.getChildrenCount(); i++) {
      const found = this.searchLabel(object.getChild(i), label);
      if (found !== null) return found;
    }
    return null;
  }

  /** Climb from a label to whatever is actually pressable. */
  private interactableAbove(object: SceneObject): Interactable | null {
    let node: SceneObject | null = object;
    for (let depth = 0; node !== null && depth < 6; depth++) {
      const found = node.getComponent(Interactable.getTypeName()) as Interactable | null;
      if (found !== null && node.enabled) return found;
      node = node.getParent();
    }
    return null;
  }

  private wait(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const event = this.createEvent('DelayedCallbackEvent');
      event.bind(() => resolve());
      event.reset(seconds);
    });
  }
}
