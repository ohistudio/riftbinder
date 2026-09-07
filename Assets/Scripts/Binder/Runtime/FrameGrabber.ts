// Binder — camera texture to a small grayscale buffer. Lens runtime.
//
// The one piece of the detection pipeline that genuinely needs a device. The
// maths it feeds (QuadDetect, QuadTracking) is pure and tested; this file only
// moves pixels.
//
// Detection runs on a DOWNSAMPLED frame — 64x48 by default. A card held at
// arm's length is tens of pixels across at that size, which is ample for
// locating a rectangle, and it keeps the per-frame cost affordable: full
// resolution would be ~100x the work for no extra reliability at this job.
//
// Nearest-neighbour sampling, deliberately. Averaging would soften exactly the
// edges the detector depends on.

const TAG = '[Binder][frame]';

export class FrameGrabber {
  private proceduralTexture: Texture | null = null;
  private rgba: Uint8Array | null = null;
  private gray: Uint8Array | null = null;
  private sourceWidth = 0;
  private sourceHeight = 0;
  /** The exact texture the readable copy was made from. */
  private boundSource: Texture | null = null;

  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.gray = new Uint8Array(width * height);
  }

  /**
   * Read `source` and return a grayscale buffer, or null when the texture is
   * not readable yet (the camera commonly needs a frame or two to warm up).
   * The returned buffer is REUSED between calls — copy it if you need to keep it.
   */
  grab(source: Texture): Uint8Array | null {
    if (!source) return null;

    const sw = source.getWidth();
    const sh = source.getHeight();
    if (sw <= 0 || sh <= 0) return null;

    // A camera texture cannot be read directly; copy it into a procedural
    // texture, which exposes getPixels.
    //
    // Rebind when the SOURCE ITSELF changes, not just its dimensions. A live
    // camera hands back the same texture object updating in place, but anything
    // feeding fresh textures of equal size (the detection demo, a still) would
    // otherwise keep reading the very first frame forever.
    if (this.proceduralTexture === null || source !== this.boundSource
      || sw !== this.sourceWidth || sh !== this.sourceHeight) {
      const sizeChanged = sw !== this.sourceWidth || sh !== this.sourceHeight;
      this.sourceWidth = sw;
      this.sourceHeight = sh;
      this.boundSource = source;
      this.proceduralTexture = ProceduralTextureProvider.createFromTexture(source);
      if (this.rgba === null || sizeChanged) this.rgba = new Uint8Array(sw * sh * 4);
      if (sizeChanged) console.log(`${TAG} source ${sw}x${sh} -> detect ${this.width}x${this.height}`);
    }

    const provider = this.proceduralTexture.control as ProceduralTextureProvider;
    const rgba = this.rgba as Uint8Array;
    try {
      provider.getPixels(0, 0, sw, sh, rgba);
    } catch (e) {
      console.warn(`${TAG} getPixels failed: ${e}`);
      return null;
    }

    const gray = this.gray as Uint8Array;
    const xStep = sw / this.width;
    const yStep = sh / this.height;

    for (let y = 0; y < this.height; y++) {
      const sy = Math.min(sh - 1, Math.floor(y * yStep));
      const rowOffset = sy * sw;
      const outRow = y * this.width;
      for (let x = 0; x < this.width; x++) {
        const sx = Math.min(sw - 1, Math.floor(x * xStep));
        const i = (rowOffset + sx) * 4;
        // Rec. 601 luma, integer-weighted to avoid float work per pixel.
        gray[outRow + x] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
      }
    }
    return gray;
  }

  /**
   * Copy the region a detection covers into a standalone texture, for sending
   * to vision. Coordinates are in DETECT pixels and are scaled back up to the
   * source, with a margin so the card's border and collector number are not
   * shaved off by a tight bounding box.
   */
  cropToTexture(x: number, y: number, width: number, height: number, marginFraction = 0.06): Texture | null {
    if (this.rgba === null || this.sourceWidth <= 0) return null;

    const scaleX = this.sourceWidth / this.width;
    const scaleY = this.sourceHeight / this.height;
    const marginX = width * scaleX * marginFraction;
    const marginY = height * scaleY * marginFraction;

    const left = Math.max(0, Math.floor(x * scaleX - marginX));
    const top = Math.max(0, Math.floor(y * scaleY - marginY));
    const right = Math.min(this.sourceWidth, Math.ceil((x + width) * scaleX + marginX));
    const bottom = Math.min(this.sourceHeight, Math.ceil((y + height) * scaleY + marginY));

    const cropWidth = right - left;
    const cropHeight = bottom - top;
    if (cropWidth <= 1 || cropHeight <= 1) return null;

    const cropped = ProceduralTextureProvider.createWithFormat(cropWidth, cropHeight, TextureFormat.RGBA8Unorm);
    const provider = cropped.control as ProceduralTextureProvider;
    const data = new Uint8Array(cropWidth * cropHeight * 4);
    const rgba = this.rgba;

    for (let row = 0; row < cropHeight; row++) {
      const sourceOffset = ((top + row) * this.sourceWidth + left) * 4;
      const destOffset = row * cropWidth * 4;
      for (let i = 0; i < cropWidth * 4; i++) data[destOffset + i] = rgba[sourceOffset + i];
    }

    provider.setPixels(0, 0, cropWidth, cropHeight, data);
    return cropped;
  }

  /** Map a detection back onto normalised source coordinates (0..1). */
  toNormalised(xPx: number, yPx: number): { x: number; y: number } {
    return { x: xPx / this.width, y: yPx / this.height };
  }
}
