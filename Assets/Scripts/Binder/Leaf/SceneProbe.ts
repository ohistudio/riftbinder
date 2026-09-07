// Binder — finding things in a running scene. Lens runtime, PREVIEW ONLY.
//
// Shared by the LEAF scenarios. Pulled out of ScanRehearsal when a second
// scenario needed the same lookups: two copies of "find the button that says
// X" is two places for the rules to drift, and those rules are subtle enough
// to be worth stating once.
//
// Everything here is a free function over the live scene. Nothing depends on a
// scenario instance, so it is all testable by reading rather than by running.

import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';

/** Depth-first search of the whole scene by object name. */
export function findByName(name: string): SceneObject | null {
  const count = global.scene.getRootObjectsCount();
  for (let i = 0; i < count; i++) {
    const root = global.scene.getRootObject(i);
    if (root.name === name) return root;
    const found = findDescendant(root, name);
    if (found !== null) return found;
  }
  return null;
}

export function findDescendant(object: SceneObject, name: string): SceneObject | null {
  for (let i = 0; i < object.getChildrenCount(); i++) {
    const child = object.getChild(i);
    if (child.name === name) return child;
    const found = findDescendant(child, name);
    if (found !== null) return found;
  }
  return null;
}

/** The first Text in a subtree, itself included. */
export function firstText(object: SceneObject): Text | null {
  const own = object.getComponent('Component.Text') as Text | null;
  if (own !== null) return own;
  for (let i = 0; i < object.getChildrenCount(); i++) {
    const found = firstText(object.getChild(i));
    if (found !== null) return found;
  }
  return null;
}

/**
 * Find a control by the words printed on it.
 *
 * Not by object name: a UIKit row is a SceneObject called "Item" with its
 * label in a grandchild Text, so names identify nothing. The text a person
 * would read is the stable handle.
 *
 * ALWAYS scope this to a panel when the label is a common word. A bare search
 * for "Ask" matches the assistant's Ask button, the scan panel's Ask button and
 * the controls bar's "Hold to ask", and you get whichever the walk reaches
 * first — which is how a run ended up staring at the wrong panel.
 */
export function searchLabel(object: SceneObject, label: string): Interactable | null {
  // A disabled subtree is invisible and unpressable, so nothing in it counts.
  // Checked here, on the way DOWN: a child's own `enabled` flag stays true when
  // its parent is off, so testing the label's object alone let a hidden Choose
  // button match — and the climb then landed on the panel's background.
  if (!object.enabled) return null;
  const text = object.getComponent('Component.Text') as Text | null;
  if (text !== null && text.text.indexOf(label) !== -1) {
    const owner = interactableAbove(object);
    if (owner !== null) return owner;
  }
  for (let i = 0; i < object.getChildrenCount(); i++) {
    const found = searchLabel(object.getChild(i), label);
    if (found !== null) return found;
  }
  return null;
}

/** Search the whole scene for a control by its printed label. */
export function findInteractable(label: string): Interactable | null {
  const count = global.scene.getRootObjectsCount();
  for (let i = 0; i < count; i++) {
    const found = searchLabel(global.scene.getRootObject(i), label);
    if (found !== null) return found;
  }
  return null;
}

/** Climb from a label to whatever is actually pressable. */
export function interactableAbove(object: SceneObject): Interactable | null {
  let node: SceneObject | null = object;
  for (let depth = 0; node !== null && depth < 6; depth++) {
    const found = node.getComponent(Interactable.getTypeName()) as Interactable | null;
    if (found !== null && node.enabled) return found;
    node = node.getParent();
  }
  return null;
}

/** Every enabled Interactable in a subtree, in hierarchy order. */
export function interactablesUnder(object: SceneObject): Interactable[] {
  const found: Interactable[] = [];
  collectInteractables(object, found);
  return found;
}

function collectInteractables(object: SceneObject, into: Interactable[]): void {
  if (!object.enabled) return;
  const own = object.getComponent(Interactable.getTypeName()) as Interactable | null;
  if (own !== null) into.push(own);
  for (let i = 0; i < object.getChildrenCount(); i++) {
    collectInteractables(object.getChild(i), into);
  }
}

/**
 * The camera the WEARER looks through.
 *
 * Skips Binder's own capture camera: it renders to a texture, and aiming a
 * rehearsal at it would put the card outside the wearer's view entirely.
 */
export function findWearerCamera(): Camera | null {
  const count = global.scene.getRootObjectsCount();
  for (let i = 0; i < count; i++) {
    const found = searchCamera(global.scene.getRootObject(i));
    if (found !== null) return found;
  }
  return null;
}

function searchCamera(object: SceneObject): Camera | null {
  const camera = object.getComponent('Component.Camera') as Camera | null;
  if (camera !== null && object.name.indexOf('Scan Camera') === -1) return camera;
  for (let i = 0; i < object.getChildrenCount(); i++) {
    const found = searchCamera(object.getChild(i));
    if (found !== null) return found;
  }
  return null;
}

/**
 * Hold a card up in front of the camera, square on.
 *
 * Square matters: the collector number is the smallest print on the card and
 * the first thing lost to a foreshortened angle. `dropCm` is measured against
 * a capture that only sees about 55 cm of height at this distance, so small
 * changes move the card a long way up or down the picture.
 */
export function holdCardAt(
  card: SceneObject, camera: Camera, distanceCm: number, dropCm: number, rollDeg = 0,
): void {
  const eye = camera.getSceneObject().getTransform();
  const rotation = eye.getWorldRotation();
  // Transform.forward points BACKWARDS in this runtime, so the look direction
  // is derived by rotating -Z rather than trusting it.
  const look = rotation.multiplyVec3(new vec3(0, 0, -1));
  const up = rotation.multiplyVec3(new vec3(0, 1, 0));

  const target = eye.getWorldPosition()
    .add(look.uniformScale(distanceCm))
    .add(up.uniformScale(dropCm));

  // Plain camera rotation, which is what scan-rengar proves works for these
  // card objects. Two attempts at composing a "stand up" quaternion on top of
  // it — +90 and -90 about X — each turned the card away from the camera
  // instead of towards it, so the assumption that the quad's face normal is
  // local +Y is wrong for this mesh. Left alone until measured rather than
  // guessed at.
  // `rollDeg` spins the card in the plane of the picture. Not every card image
  // is authored the same way up: RengarCardMain's is landscape where
  // RengarCard's is portrait, so with a common rotation one of them reaches the
  // model lying on its side, and a sideways card reads as no card at all.
  const roll = quat.angleAxis((rollDeg * Math.PI) / 180, new vec3(0, 0, 1));

  const transform = card.getTransform();
  transform.setWorldRotation(rollDeg === 0 ? rotation : rotation.multiply(roll));
  transform.setWorldPosition(target);

  // Correct for an off-centre pivot. Some card objects carry their artwork on
  // a child that sits well away from the parent's origin, so moving the parent
  // to the target leaves the VISIBLE card somewhere else — which is how one
  // card photographed square in the middle of frame and another ended up a
  // tilted thumbnail in the corner. Measure where the art actually landed and
  // shift by the difference.
  const visual = firstVisual(card);
  if (visual === null) return;
  const actual = visual.getSceneObject().getTransform().getWorldPosition();
  const drift = target.sub(actual);
  transform.setWorldPosition(target.add(drift));
}

/** The first RenderMeshVisual in a subtree — the thing you can actually see. */
function firstVisual(object: SceneObject): RenderMeshVisual | null {
  const own = object.getComponent('Component.RenderMeshVisual') as RenderMeshVisual | null;
  if (own !== null) return own;
  for (let i = 0; i < object.getChildrenCount(); i++) {
    const found = firstVisual(object.getChild(i));
    if (found !== null) return found;
  }
  return null;
}
