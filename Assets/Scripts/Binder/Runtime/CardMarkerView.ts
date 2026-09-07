// Binder — a marker sitting on a real card, in world space. Lens runtime.
//
// Where DetectionDebugView draws boxes inside a panel (the panel IS the frame),
// this places one marker per tracker OUT IN THE WORLD, at the distance implied
// by the card's apparent size (Core/Projection.ts).
//
// Same two behaviours that made the panel readable, for the same reasons:
//   * keyed by TRACKER ID, so a marker belongs to a card rather than a slot;
//   * LERPED, and held through a dropped frame before fading. Detection is
//     intermittent by nature; hiding on the first miss makes markers strobe.
//
// Markers billboard to the camera. A detection is an axis-aligned rectangle and
// carries no orientation, so pretending to know the card's tilt would be a lie —
// facing the viewer is the honest presentation of what was actually measured.

import { makePlate, makeLabel } from './ViewUtils';

const EDGE_THICKNESS_CM = 0.35;
const FOLLOW_RATE = 12;
const GRACE_MS = 700;
const FADE_MS = 400;

interface Marker {
  root: SceneObject;
  edges: SceneObject[];
  materials: Material[];
  label: Text;
  currentPos: vec3;
  targetPos: vec3;
  currentWidth: number;
  currentHeight: number;
  targetWidth: number;
  targetHeight: number;
  placed: boolean;
  lastSeenMs: number;
  opacity: number;
}

export interface MarkerUpdate {
  trackerId: string;
  worldPosition: vec3;
  widthCm: number;
  heightCm: number;
  /** Shown under the marker: card name once identified, distance until then. */
  caption: string;
}

export class CardMarkerView {
  private readonly markers = new Map<string, Marker>();

  constructor(
    private readonly root: SceneObject,
    private readonly mesh: RenderMesh,
    private readonly material: Material,
    private readonly font: Font,
  ) {}

  /** Point each marker at where its card now is. `advance` does the moving. */
  setMarkers(updates: readonly MarkerUpdate[]): void {
    const nowMs = getTime() * 1000;
    for (const update of updates) {
      const marker = this.markerFor(update.trackerId);
      marker.lastSeenMs = nowMs;
      marker.targetPos = update.worldPosition;
      marker.targetWidth = update.widthCm;
      marker.targetHeight = update.heightCm;
      marker.label.text = update.caption;
      if (!marker.placed) {
        marker.currentPos = update.worldPosition;
        marker.currentWidth = update.widthCm;
        marker.currentHeight = update.heightCm;
        marker.placed = true;
      }
    }
  }

  /** Move markers toward their targets and billboard them at the viewer. */
  advance(deltaSeconds: number, cameraRotation: quat): void {
    const nowMs = getTime() * 1000;
    const k = 1 - Math.exp(-FOLLOW_RATE * Math.max(0, deltaSeconds));
    const dead: string[] = [];

    this.markers.forEach((marker, trackerId) => {
      const age = nowMs - marker.lastSeenMs;
      let opacity = 1;
      if (age > GRACE_MS) opacity = 1 - Math.min(1, (age - GRACE_MS) / FADE_MS);
      if (opacity <= 0) { dead.push(trackerId); return; }

      marker.currentPos = new vec3(
        marker.currentPos.x + (marker.targetPos.x - marker.currentPos.x) * k,
        marker.currentPos.y + (marker.targetPos.y - marker.currentPos.y) * k,
        marker.currentPos.z + (marker.targetPos.z - marker.currentPos.z) * k,
      );
      marker.currentWidth += (marker.targetWidth - marker.currentWidth) * k;
      marker.currentHeight += (marker.targetHeight - marker.currentHeight) * k;

      const transform = marker.root.getTransform();
      transform.setWorldPosition(marker.currentPos);
      transform.setWorldRotation(cameraRotation);
      marker.root.enabled = true;

      this.sizeEdges(marker, marker.currentWidth, marker.currentHeight);

      if (opacity !== marker.opacity) {
        marker.opacity = opacity;
        for (const material of marker.materials) {
          material.mainPass.baseColor = new vec4(0.15, 0.95, 0.55, opacity);
        }
      }
    });

    for (const trackerId of dead) {
      const marker = this.markers.get(trackerId);
      if (marker !== undefined) marker.root.destroy();
      this.markers.delete(trackerId);
    }
  }

  count(): number {
    return this.markers.size;
  }

  private sizeEdges(marker: Marker, widthCm: number, heightCm: number): void {
    const halfW = widthCm / 2;
    const halfH = heightCm / 2;
    const place = (edge: SceneObject, x: number, y: number, w: number, h: number): void => {
      edge.getTransform().setLocalPosition(new vec3(x, y, 0));
      // makePlate stands the quad up about X, so height maps to local Z.
      edge.getTransform().setLocalScale(new vec3(w, 1, h));
    };
    place(marker.edges[0], 0, halfH, widthCm, EDGE_THICKNESS_CM);
    place(marker.edges[1], 0, -halfH, widthCm, EDGE_THICKNESS_CM);
    place(marker.edges[2], -halfW, 0, EDGE_THICKNESS_CM, heightCm);
    place(marker.edges[3], halfW, 0, EDGE_THICKNESS_CM, heightCm);
    marker.label.getTransform().setLocalPosition(new vec3(0, -halfH - 2.2, 0));
  }

  private markerFor(trackerId: string): Marker {
    const existing = this.markers.get(trackerId);
    if (existing !== undefined) return existing;

    const root = global.scene.createSceneObject(`Card Marker ${trackerId}`);
    root.setParent(this.root);

    const materials: Material[] = [];
    const edges: SceneObject[] = [];
    for (const name of ['Top', 'Bottom', 'Left', 'Right']) {
      const plate = makePlate(root, this.mesh, this.material, 1, 1);
      plate.object.name = name;
      plate.material.mainPass.baseColor = new vec4(0.15, 0.95, 0.55, 1);
      materials.push(plate.material);
      edges.push(plate.object);
    }

    const label = makeLabel(root, this.font, {
      name: 'Caption', xCm: 0, yCm: -6, zCm: 0,
      widthCm: 16, heightCm: 2.4,
    });

    const created: Marker = {
      root, edges, materials, label,
      currentPos: new vec3(0, 0, 0),
      targetPos: new vec3(0, 0, 0),
      currentWidth: 1, currentHeight: 1, targetWidth: 1, targetHeight: 1,
      placed: false,
      lastSeenMs: getTime() * 1000,
      opacity: 1,
    };
    this.markers.set(trackerId, created);
    return created;
  }
}
