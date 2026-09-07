// Binder — shared view construction. Lens runtime.
//
// Two rules learned the hard way and encoded here:
//  1. Never scale a node that has Text children. Non-uniform scale on the
//     parent distorts glyphs and makes `size` meaningless. Scale a dedicated
//     Plate child instead and leave the root at unit scale.
//  2. Always give Text a layoutRect plus Shrink overflow, or a long card name
//     runs straight across its neighbours.

export interface Plate {
  object: SceneObject;
  material: Material;
}

/**
 * A coloured quad of exactly widthCm x heightCm, standing upright facing +Z.
 *
 * The plane mesh is NOT assumed to be a unit square in XY. PlaneMeshPreset is a
 * GROUND plane — it lies in XZ, normal on +Y, and is not 1x1 — so a naive
 * setLocalScale(w, h, 1) renders an edge-on sliver of the wrong aspect. Instead
 * we read the mesh's own AABB, work out which axis is its normal, and derive
 * the scale and stand-up rotation from that. Swap in any other quad mesh and
 * this still produces the size that was asked for.
 */
export function makePlate(
  parent: SceneObject,
  mesh: RenderMesh,
  materialTemplate: Material,
  widthCm: number,
  heightCm: number,
  zCm = 0,
): Plate {
  const object = global.scene.createSceneObject('Plate');
  object.setParent(parent);
  object.getTransform().setLocalPosition(new vec3(0, 0, zCm));

  const size = new vec3(
    mesh.aabbMax.x - mesh.aabbMin.x,
    mesh.aabbMax.y - mesh.aabbMin.y,
    mesh.aabbMax.z - mesh.aabbMin.z,
  );
  const flat = 1e-4;
  if (size.z <= flat && size.x > flat && size.y > flat) {
    // Already an upright XY quad: scale straight onto width/height.
    object.getTransform().setLocalScale(new vec3(widthCm / size.x, heightCm / size.y, 1));
  } else if (size.y <= flat && size.x > flat && size.z > flat) {
    // Ground plane: stand it up about X so its local Z becomes world height.
    object.getTransform().setLocalRotation(quat.fromEulerAngles(Math.PI / 2, 0, 0));
    object.getTransform().setLocalScale(new vec3(widthCm / size.x, 1, heightCm / size.z));
  } else {
    console.warn('[Binder] plate mesh is not a flat quad — falling back to raw scale');
    object.getTransform().setLocalScale(new vec3(widthCm, heightCm, 1));
  }

  const rmv = object.createComponent('Component.RenderMeshVisual') as RenderMeshVisual;
  rmv.mesh = mesh;
  // Materials are shared assets — clone or every plate recolours together.
  const material = materialTemplate.clone();
  rmv.clearMaterials();
  rmv.addMaterial(material);

  return { object, material };
}

export interface LabelSpec {
  name: string;
  /** Type role. Drives size and colour; defaults to Body. */
  role?: TextRole;
  /** How far the label sits from the eye, cm. Sizes scale with it. */
  distanceCm?: number;
  /** Importance. Additive displays do hierarchy with opacity, not grey. */
  tone?: 'primary' | 'secondary' | 'tertiary';
  /** Let long text shrink to fit rather than overflow. On by default. */
  shrink?: boolean;
  /** Centre of the label in parent-local cm. */
  xCm: number;
  yCm: number;
  zCm: number;
  widthCm: number;
  heightCm: number;
}

/** Text constrained to a box, shrinking rather than overrunning it. */
import type { TextRole } from '../Core/Typography';
import { roleSize, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY } from '../Core/Typography';

/** Config stores plain rgb; the runtime wants an opaque vec4. */
export function uiColor(rgb: { r: number; g: number; b: number }): vec4 {
  return new vec4(rgb.r, rgb.g, rgb.b, 1);
}

export function makeLabel(parent: SceneObject, font: Font, spec: LabelSpec): Text {
  const object = global.scene.createSceneObject(spec.name);
  object.setParent(parent);
  object.getTransform().setLocalPosition(new vec3(spec.xCm, spec.yCm, spec.zCm));

  const text = object.createComponent('Component.Text') as Text;
  text.font = font;
  text.size = roleSize(spec.role ?? 'Body', spec.distanceCm);
  text.text = '';
  text.layoutRect = Rect.create(-spec.widthCm / 2, spec.widthCm / 2, -spec.heightCm / 2, spec.heightCm / 2);

  const tone = spec.tone ?? 'primary';
  const rgba = tone === 'secondary' ? TEXT_SECONDARY
    : tone === 'tertiary' ? TEXT_TERTIARY : TEXT_PRIMARY;
  text.textFill.color = new vec4(rgba.r, rgba.g, rgba.b, rgba.a);

  // Shrink is a safety net for text whose length is not known — card names run
  // from "Jinx" to "Rengar - Trophy Hunter". Headings that are sized to their
  // box opt out, or the scale is silently undone by the box.
  const shrink = spec.shrink ?? true;
  text.horizontalOverflow = shrink ? HorizontalOverflow.Shrink : HorizontalOverflow.Overflow;
  text.verticalOverflow = VerticalOverflow.Shrink;
  return text;
}

/**
 * Resize an existing plate. Needed because a card's aspect is not known when
 * the tile is built — a battlefield is landscape while everything else is
 * portrait, and tiles are recycled between the two.
 */
export function resizePlate(
  object: SceneObject, mesh: RenderMesh, widthCm: number, heightCm: number,
): void {
  const size = new vec3(
    mesh.aabbMax.x - mesh.aabbMin.x,
    mesh.aabbMax.y - mesh.aabbMin.y,
    mesh.aabbMax.z - mesh.aabbMin.z,
  );
  const flat = 1e-4;
  if (size.z <= flat && size.x > flat && size.y > flat) {
    object.getTransform().setLocalScale(new vec3(widthCm / size.x, heightCm / size.y, 1));
  } else if (size.y <= flat && size.x > flat && size.z > flat) {
    object.getTransform().setLocalScale(new vec3(widthCm / size.x, 1, heightCm / size.z));
  }
}

/**
 * Collider sized to a plate, so SIK Interactables actually receive input.
 *
 * A ColliderComponent with no shape assigned is inert — it reports no hits and
 * every hover/trigger silently times out. SIK's own ColliderUtils only honours
 * `fitVisual` for Box and Sphere shapes, so the shape has to be created and
 * assigned explicitly rather than left at its default.
 */
export function fitCollider(object: SceneObject, depthCm = 1): ColliderComponent {
  // fitVisual fits the object's OWN visual. Given an object whose visuals are
  // all children, it silently leaves a 1 cm cube — an interactable that looks
  // right, reports no error, and cannot be hit. That cost a whole unclickable
  // main menu, so say so loudly instead.
  if (object.getComponent('Component.RenderMeshVisual') === null) {
    console.warn(`[Binder] fitCollider on "${object.name}" which has no visual of `
      + 'its own — the collider cannot be sized and will not be hittable. '
      + 'Attach it to the plate instead.');
  }
  const collider = object.createComponent('Physics.ColliderComponent') as ColliderComponent;
  const box = Shape.createBoxShape();
  box.size = new vec3(1, 1, depthCm);
  collider.shape = box;
  collider.fitVisual = true;
  return collider;
}
