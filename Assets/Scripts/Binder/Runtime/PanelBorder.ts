// Binder — the rim around a panel. Built with MeshBuilder. Lens runtime.
//
// Why a mesh and not UIKit's own inset border: UIKit can only draw its border
// INSIDE the plate, in one flat colour or a gradient it controls. A separate
// mesh sits just in front of the plate, carries its own vertex colours, and is
// lit by nothing — so on an additive display it reads as a bright edge rather
// than a darker inset line. On Specs a panel with no edge dissolves into the
// room; the rim is what makes it a surface with a boundary.
//
// The shape is a rounded-rectangle RING: an inner and an outer contour walked
// together, quad by quad. Both contours come from the same four corner arcs, so
// the straight sections fall out of the geometry rather than being special
// cases — the last point of one arc and the first of the next are already the
// tangent points, and the quad between them is the straight edge.

const CORNER_SEGMENTS = 8;
const BORDER_OBJECT_NAME = 'Panel Border';

/** Colour along the rim. Interpolated top to bottom so it echoes the panel. */
export interface BorderColours {
  top: vec4;
  bottom: vec4;
}

/**
 * Build the ring and hang it on `parent`.
 *
 * Sits slightly proud of the plate (z) so it is not fighting the plate's own
 * front face for depth, but still behind the content, which lives further
 * forward again.
 */
export function makeBorder(
  parent: SceneObject,
  material: Material,
  widthCm: number,
  heightCm: number,
  opts: {
    radiusCm?: number; thicknessCm?: number; zCm?: number; colours?: BorderColours;
    tint?: vec4;
  } = {},
): SceneObject {
  const radius = opts.radiusCm !== undefined ? opts.radiusCm : 2.2;
  const thickness = opts.thicknessCm !== undefined ? opts.thicknessCm : 0.45;
  // In FRONT of the plate, not just proud of it. UIKit's BackPlate body is
  // about a centimetre thick, so a rim at +0.35 sits inside the slab and is
  // never seen — which is exactly what happened the first time.
  const z = opts.zCm !== undefined ? opts.zCm : 0.62;
  const colours = opts.colours !== undefined ? opts.colours : DEFAULT_BORDER;

  const object = global.scene.createSceneObject(BORDER_OBJECT_NAME);
  object.setParent(parent);
  object.getTransform().setLocalPosition(new vec3(0, 0, z));

  const visual = object.createComponent('Component.RenderMeshVisual') as RenderMeshVisual;
  visual.mesh = buildRing(widthCm, heightCm, radius, thickness, colours);
  visual.clearMaterials();
  // Cloned: every panel tints its own copy, and a shared material would mean
  // the last panel built decided the colour for all of them.
  const mat = material.clone();
  mat.mainPass.baseColor = opts.tint !== undefined ? opts.tint : DEFAULT_TINT;
  visual.addMaterial(mat);
  return object;
}

/** Flat rim colour, used by the unlit material. */
const DEFAULT_TINT = new vec4(0.42, 0.62, 1.0, 1);

/** Cyan at the top falling to violet — a light source above and in front. */
const DEFAULT_BORDER: BorderColours = {
  top: new vec4(0.45, 0.85, 1.0, 1),
  bottom: new vec4(0.52, 0.34, 0.95, 1),
};

function buildRing(
  widthCm: number, heightCm: number, radiusCm: number, thicknessCm: number,
  colours: BorderColours,
): RenderMesh {
  const halfW = widthCm / 2;
  const halfH = heightCm / 2;
  // A radius larger than half the shorter side would make the arcs cross over
  // each other and turn the ring inside out.
  const radius = Math.max(0.01, Math.min(radiusCm, Math.min(halfW, halfH) - 0.01));
  const half = thicknessCm / 2;

  const builder = new MeshBuilder([
    { name: 'position', components: 3 },
    { name: 'normal', components: 3, normalized: true },
    { name: 'color', components: 4 },
  ]);
  builder.topology = MeshTopology.Triangles;
  builder.indexType = MeshIndexType.UInt16;

  // The four corner centres, walked anticlockwise from the top right. Going
  // anticlockwise matters: it makes the quads below wind CCW as seen from +Z,
  // which is the side the wearer is on.
  const corners = [
    { cx: halfW - radius, cy: halfH - radius, from: 0 },
    { cx: -(halfW - radius), cy: halfH - radius, from: 90 },
    { cx: -(halfW - radius), cy: -(halfH - radius), from: 180 },
    { cx: halfW - radius, cy: -(halfH - radius), from: 270 },
  ];

  const verts: number[] = [];
  let count = 0;
  for (const corner of corners) {
    for (let s = 0; s <= CORNER_SEGMENTS; s += 1) {
      const degrees = corner.from + (90 * s) / CORNER_SEGMENTS;
      const radians = (degrees * Math.PI) / 180;
      const nx = Math.cos(radians);
      const ny = Math.sin(radians);

      // Inner and outer sit on the same ray, so the rim keeps an even width
      // all the way round including through the curves.
      const ix = corner.cx + (radius - half) * nx;
      const iy = corner.cy + (radius - half) * ny;
      const ox = corner.cx + (radius + half) * nx;
      const oy = corner.cy + (radius + half) * ny;

      const inner = colourAt(iy, halfH, colours);
      const outer = colourAt(oy, halfH, colours);
      verts.push(ix, iy, 0, 0, 0, 1, inner.r, inner.g, inner.b, inner.a);
      verts.push(ox, oy, 0, 0, 0, 1, outer.r, outer.g, outer.b, outer.a);
      count += 2;
    }
  }
  builder.appendVerticesInterleaved(verts);

  // Pairs of vertices around the loop, closed back onto the first pair.
  const pairs = count / 2;
  const indices: number[] = [];
  for (let i = 0; i < pairs; i += 1) {
    const a = i * 2;
    const b = ((i + 1) % pairs) * 2;
    // Wound so the face normal comes out towards +Z, the side the wearer is
    // on. Walking the loop anticlockwise and taking (a, b, b+1) puts the
    // normal at -Z and every triangle is back-face culled — the ring builds,
    // reports valid, attaches, and draws absolutely nothing.
    indices.push(a, b + 1, b);
    indices.push(a, a + 1, b + 1);
  }
  builder.appendIndices(indices);

  builder.updateMesh();
  return builder.getMesh();
}

/** Lerp the rim colour by height, so the gradient runs down the panel. */
function colourAt(y: number, halfH: number, colours: BorderColours): vec4 {
  const t = Math.max(0, Math.min(1, (y + halfH) / (halfH * 2)));
  const bottom = colours.bottom;
  const top = colours.top;
  return new vec4(
    bottom.r + (top.r - bottom.r) * t,
    bottom.g + (top.g - bottom.g) * t,
    bottom.b + (top.b - bottom.b) * t,
    bottom.a + (top.a - bottom.a) * t,
  );
}

/**
 * Rebuild a panel's rim at a new size.
 *
 * Panels that hug their contents — the controls strip, the deck sheet — resize
 * their plate as the screen changes. The rim is a mesh built once, so without
 * this it keeps the size it was born at and ends up slicing through the very
 * buttons it is supposed to frame.
 */
export function resizeBorder(
  parent: SceneObject, widthCm: number, heightCm: number,
  opts: { radiusCm?: number; thicknessCm?: number; colours?: BorderColours } = {},
): void {
  const count = parent.getChildrenCount();
  for (let i = 0; i < count; i += 1) {
    const child = parent.getChild(i);
    if (child.name !== BORDER_OBJECT_NAME) continue;
    const visual = child.getComponent('Component.RenderMeshVisual') as RenderMeshVisual | null;
    if (visual === null) continue;
    const radius = opts.radiusCm !== undefined ? opts.radiusCm : 2.2;
    const thickness = opts.thicknessCm !== undefined ? opts.thicknessCm : 0.45;
    const colours = opts.colours !== undefined ? opts.colours : DEFAULT_BORDER;
    visual.mesh = buildRing(widthCm, heightCm, radius, thickness, colours);
    return;
  }
}
