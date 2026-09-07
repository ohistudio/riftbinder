// Binder — make card detection and tracking VISIBLE. Dev only. Lens runtime.
//
// Detection and tracking are otherwise invisible: they run, they log, and there
// is nothing to look at. This renders the frame the detector actually saw, with
// a box drawn over what it found and the tracker id printed underneath.
//
// The point of animating the card (see BinderApp.stepDetectionDemo) is that a
// static box only demonstrates DETECTION. Watching the box follow a moving card
// while the id stays the same is what demonstrates TRACKING.
//
// Two things keep it readable rather than twitchy:
//   * Boxes are keyed by TRACKER ID, not by index, so a box belongs to a card
//     rather than to a slot in a list.
//   * The box LERPS toward its target and SURVIVES a dropped frame. Detection
//     is inherently intermittent — a missed frame is normal, and hiding the box
//     the instant one is missed makes it strobe. It holds its last position for
//     a grace period and only then fades out.

import { makePlate, makeLabel } from './ViewUtils';
import type { DetectionView } from './CardDetector';

/** Four thin plates drawn as a hollow rectangle. */
interface BoxEdges {
  top: SceneObject;
  bottom: SceneObject;
  left: SceneObject;
  right: SceneObject;
}

interface BoxState {
  root: SceneObject;
  edges: BoxEdges;
  materials: Material[];
  /** Where it is drawn now — chases `target`. */
  current: { x: number; y: number; width: number; height: number };
  target: { x: number; y: number; width: number; height: number };
  /** False until the first target arrives, so a new box does not fly in from 0,0. */
  placed: boolean;
  lastSeenMs: number;
  opacity: number;
}

const EDGE_THICKNESS_CM = 0.5;
/** Higher chases the card faster. ~14 settles in about a fifth of a second. */
const FOLLOW_RATE = 14;
/** Hold a box this long after its last sighting before fading it out. */
const GRACE_MS = 700;
const FADE_MS = 350;

export class DetectionDebugView {
  private readonly sceneMaterial: Material;
  private readonly label: Text;
  private readonly boxes = new Map<string, BoxState>();
  private readonly widthCm: number;
  private readonly heightCm: number;
  private readonly boxRoot: SceneObject;
  private readonly mesh: RenderMesh;
  private readonly plateMaterial: Material;

  constructor(
    root: SceneObject,
    mesh: RenderMesh,
    plateMaterial: Material,
    artMaterial: Material,
    font: Font,
    widthCm: number,
    heightCm: number,
  ) {
    this.widthCm = widthCm;
    this.heightCm = heightCm;
    this.mesh = mesh;
    this.plateMaterial = plateMaterial;

    const scenePlate = makePlate(root, mesh, artMaterial, widthCm, heightCm);
    this.sceneMaterial = scenePlate.material;

    this.boxRoot = global.scene.createSceneObject('Detection Boxes');
    this.boxRoot.setParent(root);
    this.boxRoot.getTransform().setLocalPosition(new vec3(0, 0, 0.2));

    this.label = makeLabel(root, font, {
      name: 'Detection Label', xCm: 0, yCm: -heightCm * 0.62, zCm: 0.2,
      widthCm: widthCm * 1.1, heightCm: heightCm * 0.16,
    });
    this.label.text = 'detector idle';
  }

  /** Show the exact frame the detector ran on. */
  setFrame(texture: Texture): void {
    this.sceneMaterial.mainPass.baseTex = texture;
    this.sceneMaterial.mainPass.baseColor = new vec4(1, 1, 1, 1);
  }

  /**
   * Point each box at where its card now is. Nothing moves here — `advance`
   * does the moving, so motion stays smooth regardless of detection rate.
   */
  setDetections(views: readonly DetectionView[], detectWidth: number, detectHeight: number): void {
    const nowMs = getTime() * 1000;
    const scaleX = this.widthCm / detectWidth;
    const scaleY = this.heightCm / detectHeight;

    for (const view of views) {
      const q = view.quad;
      const box = this.boxFor(view.trackerId);
      box.lastSeenMs = nowMs;
      box.target = {
        // Detect pixels -> plate centimetres.
        //
        // Y is NOT flipped here, despite image rows running downward. makePlate
        // stands the quad up by rotating +90 deg about X, which already inverts
        // the texture's V axis on screen. Flipping again mirrors the box about
        // the plate centre — it tracks the card's reflection, which looks
        // maddeningly close to correct while never sitting on the card.
        x: (q.x + q.width / 2) * scaleX - this.widthCm / 2,
        y: (q.y + q.height / 2) * scaleY - this.heightCm / 2,
        width: q.width * scaleX,
        height: q.height * scaleY,
      };
      if (!box.placed) {
        box.current = { ...box.target };   // appear in place, do not fly in
        box.placed = true;
      }
    }

    if (views.length > 0) {
      this.label.text = views
        .map((v) => `${v.trackerId}: ${v.cardId ?? 'identifying…'}`)
        .join('    ');
    }
  }

  /**
   * Move every box toward its target. Called each frame with the frame delta,
   * so the box glides at display rate even though detection runs at ~5 Hz.
   *
   * Exponential smoothing rather than a fixed step: it is frame-rate
   * independent, which a naive `current += (target - current) * 0.2` is not.
   */
  advance(deltaSeconds: number): void {
    const nowMs = getTime() * 1000;
    const k = 1 - Math.exp(-FOLLOW_RATE * Math.max(0, deltaSeconds));
    const dead: string[] = [];

    this.boxes.forEach((box, trackerId) => {
      const age = nowMs - box.lastSeenMs;

      // Held through a dropped frame, then faded — never snapped off.
      let opacity = 1;
      if (age > GRACE_MS) opacity = 1 - Math.min(1, (age - GRACE_MS) / FADE_MS);
      if (opacity <= 0) { dead.push(trackerId); return; }

      box.current.x += (box.target.x - box.current.x) * k;
      box.current.y += (box.target.y - box.current.y) * k;
      box.current.width += (box.target.width - box.current.width) * k;
      box.current.height += (box.target.height - box.current.height) * k;

      box.root.enabled = true;
      box.root.getTransform().setLocalPosition(new vec3(box.current.x, box.current.y, 0));
      this.sizeEdges(box.edges, box.current.width, box.current.height);

      if (opacity !== box.opacity) {
        box.opacity = opacity;
        for (const material of box.materials) {
          material.mainPass.baseColor = new vec4(0.1, 1, 0.45, opacity);
        }
      }
    });

    for (const trackerId of dead) {
      const box = this.boxes.get(trackerId);
      if (box !== undefined) box.root.destroy();
      this.boxes.delete(trackerId);
    }

    if (this.boxes.size === 0) this.label.text = 'no card detected';
  }

  private sizeEdges(edges: BoxEdges, widthCm: number, heightCm: number): void {
    const halfH = heightCm / 2;
    const halfW = widthCm / 2;
    edges.top.getTransform().setLocalPosition(new vec3(0, halfH, 0));
    edges.bottom.getTransform().setLocalPosition(new vec3(0, -halfH, 0));
    edges.left.getTransform().setLocalPosition(new vec3(-halfW, 0, 0));
    edges.right.getTransform().setLocalPosition(new vec3(halfW, 0, 0));
    this.scaleEdge(edges.top, widthCm, EDGE_THICKNESS_CM);
    this.scaleEdge(edges.bottom, widthCm, EDGE_THICKNESS_CM);
    this.scaleEdge(edges.left, EDGE_THICKNESS_CM, heightCm);
    this.scaleEdge(edges.right, EDGE_THICKNESS_CM, heightCm);
  }

  private scaleEdge(edge: SceneObject, widthCm: number, heightCm: number): void {
    // makePlate stood the mesh up about X, so height maps to local Z.
    edge.getTransform().setLocalScale(new vec3(widthCm, 1, heightCm));
  }

  /** One box per tracker id, created on first sighting. */
  private boxFor(trackerId: string): BoxState {
    const existing = this.boxes.get(trackerId);
    if (existing !== undefined) return existing;

    const root = global.scene.createSceneObject(`Box ${trackerId}`);
    root.setParent(this.boxRoot);
    const materials: Material[] = [];
    const edge = (name: string): SceneObject => {
      const plate = makePlate(root, this.mesh, this.plateMaterial, 1, 1);
      plate.object.name = name;
      plate.material.mainPass.baseColor = new vec4(0.1, 1, 0.45, 1);
      materials.push(plate.material);
      return plate.object;
    };

    const created: BoxState = {
      root,
      edges: { top: edge('Top'), bottom: edge('Bottom'), left: edge('Left'), right: edge('Right') },
      materials,
      current: { x: 0, y: 0, width: 0, height: 0 },
      target: { x: 0, y: 0, width: 0, height: 0 },
      placed: false,
      lastSeenMs: getTime() * 1000,
      opacity: 1,
    };
    this.boxes.set(trackerId, created);
    return created;
  }
}
