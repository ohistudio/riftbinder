// Binder — the bar you grab to move a panel. Lens runtime.
//
// A SEPARATE bar, not the panel face. Making the face draggable would put
// "move the panel" and "pick a card" on the same pinch, and every scroll would
// be a coin toss between the two. The handle is the one place where a pinch
// means move, so nothing else has to guess.

import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';
import { InteractableManipulation } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation';
import { Config } from '../Core/Config';
import { addRim } from './UIKitUtils';
import { makePlate, makeLabel, fitCollider, uiColor } from './ViewUtils';

const HANDLE_HEIGHT_CM = 4.5;

/**
 * Make `grab` drag `root` around. Translation only — a panel that can be
 * tumbled or shrunk is a panel you then have to repair.
 */
export function makeMovable(grab: SceneObject, root: SceneObject): InteractableManipulation {
  fitCollider(grab);
  const interactable = grab.createComponent(Interactable.getTypeName()) as Interactable;
  interactable.targetingMode = 3;   // Direct + Indirect: reach it or point at it.

  const manipulation = grab.createComponent(
    InteractableManipulation.getTypeName()) as InteractableManipulation;
  // BOTH, and both are needed. onAwake() derives manipulateRoot from the
  // manipulateRootSceneObject input, so whichever of the two runs last wins:
  // setting only the transform left onAwake to overwrite it with the grabbed
  // object, which is why dragging moved the card face and left the card behind.
  (manipulation as any).manipulateRootSceneObject = root;
  manipulation.setManipulateRoot(root.getTransform());
  manipulation.setCanTranslate(true);
  manipulation.setCanRotate(false);
  manipulation.setCanScale(false);
  return manipulation;
}

export class PanelHandle {
  private readonly manipulation: InteractableManipulation;
  private readonly bar: SceneObject;
  private readonly label: Text | null;

  constructor(
    /** The panel to move. The handle is a child of it and moves it as a whole. */
    root: SceneObject,
    mesh: RenderMesh,
    materialTemplate: Material,
    font: Font | null,
    widthCm: number,
    /** Wall-local y of the bar: just above the panel's top edge. */
    yCm: number,
    label: string,
  ) {
    const bar = makePlate(root, mesh, materialTemplate, widthCm, HANDLE_HEIGHT_CM, 0.1);
    bar.object.name = 'Panel Handle';
    bar.object.getTransform().setLocalPosition(new vec3(0, yCm, 0.1));
    // The `handle` palette entry, not `accent`: the accent is the one saturated
    // colour reserved for the row being pointed at, and painting the grab bar
    // with it meant every panel wore a bar as loud as the thing it was meant
    // to highlight. Still a clear step up from the panel, so it reads as the
    // thing you take hold of.
    bar.material.mainPass.baseColor = uiColor(Config.ui.handle);

    // A pill-shaped rim, so the bar belongs to the rounded, rimmed panel it
    // sits on rather than looking like a strip of tape across the top of it.
    // On the ROOT, not the bar: the bar carries the plate's non-uniform scale
    // and any child of it comes out stretched.
    const rimHost = global.scene.createSceneObject('Handle Rim');
    rimHost.setParent(root);
    rimHost.getTransform().setLocalPosition(new vec3(0, yCm, 0.2));
    addRim(rimHost, widthCm, HANDLE_HEIGHT_CM, HANDLE_HEIGHT_CM / 2 - 0.2, 0);

    let labelText: Text | null = null;
    if (font !== null) {
      // On the panel root, NOT on the bar: the bar carries the plate's
      // non-uniform scale, and a text child of it comes out stretched.
      labelText = makeLabel(root, font, {
        name: 'Handle Label', xCm: 0, yCm, zCm: 0.25,
        widthCm, heightCm: HANDLE_HEIGHT_CM, role: 'Subheadline', tone: 'secondary',
      });
      labelText.text = `≡  ${label}`;
    }

    this.bar = bar.object;
    this.label = labelText;

    // Move the PANEL, not the bar that was grabbed.
    this.manipulation = makeMovable(bar.object, root);
  }

  /**
   * Move the bar to sit above a panel of `panelHeightCm`.
   *
   * Panels that size themselves to their content outgrow the height the handle
   * was placed from, and the bar ends up sitting across the panel's own title.
   */
  followPanelHeight(panelHeightCm: number): void {
    const y = panelHeightCm / 2 + 3;
    const at = this.bar.getTransform().getLocalPosition();
    this.bar.getTransform().setLocalPosition(new vec3(at.x, y, at.z));
    if (this.label !== null) {
      const text = this.label.getSceneObject().getTransform();
      const p = text.getLocalPosition();
      text.setLocalPosition(new vec3(p.x, y, p.z));
    }
  }

  /** Fired when the user lets go, so the layout can record where it now lives. */
  onMoved(handler: () => void): void {
    this.manipulation.onManipulationEnd.add(() => handler());
  }
}
