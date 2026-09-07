// Binder — a picture of what the user is LOOKING AT. Lens runtime.
//
// CameraModule hands back the raw passthrough feed: the room, and nothing the
// Lens itself draws. In Preview that means the simulated living room — so a
// scan of a card rendered INTO the scene photographs the table it is floating
// over and reports, correctly, that there is no card.
//
// This renders the scene instead. A second camera parented to the main one,
// matched to it and pointed at a render target, produces the frame the wearer
// actually sees: passthrough underneath, Lens content on top. That is the
// frame worth sending to a model, and it is the only one that can see a card
// that only exists in the Lens.

import { makePlate } from './ViewUtils';

const TAG = '[Binder][capture]';

/**
 * Freeze a texture's CURRENT pixels into a standalone copy.
 *
 * The render target is live: Base64.encodeTextureAsync samples it whenever the
 * async encode actually runs, which can be well after the button press — so the
 * model was reading a frame from seconds later than the shutter moment. A pixel
 * copy at press time is what makes the scan photograph the instant you asked for.
 */
export function freezeTexture(source: Texture): Texture | null {
  try {
    const w = source.getWidth();
    const h = source.getHeight();
    if (w <= 0 || h <= 0) return null;
    const view = ProceduralTextureProvider.createFromTexture(source);
    const pixels = new Uint8Array(w * h * 4);
    (view.control as ProceduralTextureProvider).getPixels(0, 0, w, h, pixels);
    const frozen = ProceduralTextureProvider.createWithFormat(w, h, TextureFormat.RGBA8Unorm);
    (frozen.control as ProceduralTextureProvider).setPixels(0, 0, w, h, pixels);
    return frozen;
  } catch (e) {
    console.warn(`${TAG} could not freeze the frame: ${e}`);
    return null;
  }
}

export class SceneCapture {
  private texture: Texture | null = null;
  private camera: Camera | null = null;
  /**
   * The layer Binder's own interface is moved to for the duration of a capture.
   *
   * A NUMBERED layer, not makeUnique(): unique layers are documented as
   * bypassing the normal range, and the main camera renders LayerSet.all() —
   * so a unique layer risks hiding the whole interface from the wearer as well
   * as from the capture. 28 is inside the normal range and unused here.
   */
  private readonly hiddenLayer = LayerSet.fromNumber(28);
  /**
   * The backdrop's own layer — the mirror image of hiddenLayer.
   *
   * hiddenLayer hides Binder's panels FROM the capture; this one hides the
   * backdrop from the WEARER. A full-frame quad of the passthrough feed pinned
   * a few metres in front of the eye would otherwise blank out the room it is
   * a picture of.
   */
  private readonly backdropLayer = LayerSet.fromNumber(27);
  private backdropMaterial: Material | null = null;
  /** The camera the wearer looks through, and the layers it drew originally. */
  private source: Camera | null = null;
  private sourceLayers: LayerSet = LayerSet.all();

  /**
   * @param source the camera the user is looking through; the capture mirrors it
   * @param widthPx capture size — bigger reads smaller print, and costs more
   */
  constructor(source: Camera, widthPx = 720, heightPx = 816) {
    try {
      this.build(source, widthPx, heightPx);
    } catch (e) {
      console.warn(`${TAG} could not set up scene capture: ${e}`);
    }
  }

  /** The rendered frame, or null if the capture camera could not be built. */
  frame(): Texture | null { return this.texture; }

  /**
   * Keep a subtree OUT of the capture.
   *
   * Binder's own panels hang in the air between the wearer and whatever they
   * are pointing at, so a straight render of the scene photographs the
   * interface and the card behind it is hidden. Everything under `root` is
   * moved onto a private layer the capture camera does not draw.
   *
   * Re-walked before each scan because the wall builds tiles as it goes, and a
   * tile created after the last walk would still be in shot.
   */
  exclude(root: SceneObject): void {
    if (this.camera === null || this.source === null) return;
    this.assignLayer(root);

    // BOTH sides, and both are required. Moving the interface to its own layer
    // takes it out of the capture — and out of the wearer's view too, because
    // the main camera does not draw that layer either. So the layer is added
    // back to the source camera and withheld only from the capture.
    this.source.renderLayer = this.sourceLayers.union(this.hiddenLayer).except(this.backdropLayer);
    this.camera.renderLayer = this.sourceLayers.except(this.hiddenLayer).union(this.backdropLayer);
  }

  /**
   * Build the backdrop the room is painted onto.
   *
   * Sized to exactly fill the capture camera's frustum at `distance`, so the
   * picture the model receives is the room the wearer is looking at with the
   * Lens content composited on top — which is the frame the whole capture
   * exists to produce.
   */
  buildBackdrop(mesh: RenderMesh, materialTemplate: Material, distanceCm = 400): void {
    if (this.camera === null) return;
    const camera = this.camera;
    // fov is the VERTICAL field of view in radians at runtime.
    const heightCm = 2 * distanceCm * Math.tan(camera.fov / 2);
    const widthCm = heightCm * camera.aspect;
    const plate = makePlate(
      camera.getSceneObject(), mesh, materialTemplate, widthCm, heightCm, -distanceCm);
    this.assignBackdropLayer(plate.object);
    this.backdropMaterial = plate.material;
    // Take it off the wearer's camera NOW, not at scan time. The quad exists
    // from startup, so excluding it only during a capture left a four-metre
    // white sheet hanging in front of the room for the whole session.
    if (this.source !== null) {
      this.source.renderLayer = this.sourceLayers.except(this.backdropLayer);
    }
    console.log(`${TAG} backdrop ${Math.round(widthCm)}x${Math.round(heightCm)} at ${distanceCm}`);
  }

  /**
   * Point the backdrop at the live camera feed.
   *
   * Called just before each capture rather than once: the texture fills in
   * asynchronously, so one taken at startup can still be cold.
   */
  setBackdrop(frame: Texture | null): void {
    if (this.backdropMaterial === null || frame === null) return;
    this.backdropMaterial.mainPass.baseTex = frame;
  }

  private assignBackdropLayer(object: SceneObject): void {
    object.layer = this.backdropLayer;
    const count = object.getChildrenCount();
    for (let i = 0; i < count; i++) this.assignBackdropLayer(object.getChild(i));
  }

  private assignLayer(object: SceneObject): void {
    object.layer = this.hiddenLayer;
    const count = object.getChildrenCount();
    for (let i = 0; i < count; i++) this.assignLayer(object.getChild(i));
  }

  /**
   * Render only while a scan needs a frame. A second camera drawing the whole
   * scene every frame is a real cost to pay for something used a few times a
   * session.
   */
  setActive(active: boolean): void {
    if (this.camera !== null) this.camera.enabled = active;
  }

  private build(source: Camera, widthPx: number, heightPx: number): void {
    this.source = source;
    this.sourceLayers = source.renderLayer;
    const target = global.scene.createRenderTargetTexture();
    const provider = target.control as RenderTargetProvider;
    provider.outputResolution = RenderTargetProvider.OutputResolution.Custom;
    provider.resolution = new vec2(widthPx, heightPx);
    this.texture = target;

    // Parented to the source camera, so it inherits the head pose exactly
    // rather than trying to follow it a frame late.
    const object = global.scene.createSceneObject('Binder Scan Camera');
    object.setParent(source.getSceneObject());
    object.getTransform().setLocalPosition(vec3.zero());
    object.getTransform().setLocalRotation(quat.quatIdentity());

    const camera = object.createComponent('Component.Camera') as Camera;
    camera.type = source.type;
    camera.fov = source.fov;
    camera.near = source.near;
    camera.far = source.far;
    camera.aspect = widthPx / heightPx;
    // The same layers the user sees, or the capture misses the very content it
    // exists to photograph.
    camera.renderLayer = source.renderLayer;
    // enableClearColor is deprecated and warns on every build; the render
    // target clears itself, so mirroring it bought nothing.
    camera.inputTexture = source.inputTexture;
    camera.renderTarget = target;
    // After the main camera, so anything it draws this frame is already there.
    camera.renderOrder = source.renderOrder + 1;
    camera.enabled = false;

    this.camera = camera;
    console.log(`${TAG} scene capture ready at ${widthPx}x${heightPx} `
      + `sourceInput=${source.inputTexture !== null && source.inputTexture !== undefined}`);
  }
}
