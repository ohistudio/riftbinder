// Binder — a synthetic scene of cards on a table, built from REAL card art.
// Dev only. Lens runtime.
//
// The camera is device-only, so this is the only way to exercise the detection
// pipeline off a device. Cards are composited onto a plain background at known
// positions, with optional in-plane ROTATION, so the detector can be pushed
// until it fails and the failure can be seen rather than argued about.
//
// Allocates once and redraws in place: creating a texture per frame churns
// memory and does not match how a live camera behaves (one texture, updated).

export interface CardPlacement {
  /** Which card image, indexing the textures passed to create(). */
  cardIndex: number;
  /** Centre, 0..1 across the scene. */
  centreX: number;
  centreY: number;
  /** Card height as a fraction of scene height. */
  heightFraction: number;
  /** In-plane rotation, degrees. Non-zero is the interesting case. */
  rotationDeg: number;
}

interface CardBitmap {
  pixels: Uint8Array;
  width: number;
  height: number;
}

export class ProbeSceneBuilder {
  readonly texture: Texture;
  readonly width: number;
  readonly height: number;

  private readonly provider: ProceduralTextureProvider;
  private readonly data: Uint8Array;
  private readonly cards: CardBitmap[];
  private readonly backgroundLuma: number;

  private constructor(
    width: number, height: number, backgroundLuma: number, cards: CardBitmap[],
  ) {
    this.width = width;
    this.height = height;
    this.backgroundLuma = backgroundLuma;
    this.cards = cards;
    this.data = new Uint8Array(width * height * 4);
    this.texture = ProceduralTextureProvider.createWithFormat(width, height, TextureFormat.RGBA8Unorm);
    this.provider = this.texture.control as ProceduralTextureProvider;
  }

  static create(
    cardTextures: readonly Texture[], width: number, height: number, backgroundLuma: number,
  ): ProbeSceneBuilder | null {
    const cards: CardBitmap[] = [];
    for (const texture of cardTextures) {
      if (!texture) continue;
      const cardWidth = texture.getWidth();
      const cardHeight = texture.getHeight();
      if (cardWidth <= 0 || cardHeight <= 0) continue;
      const readable = ProceduralTextureProvider.createFromTexture(texture);
      const pixels = new Uint8Array(cardWidth * cardHeight * 4);
      try {
        (readable.control as ProceduralTextureProvider).getPixels(0, 0, cardWidth, cardHeight, pixels);
      } catch (e) {
        continue;
      }
      cards.push({ pixels, width: cardWidth, height: cardHeight });
    }
    if (cards.length === 0) return null;
    return new ProbeSceneBuilder(width, height, backgroundLuma, cards);
  }

  cardCount(): number {
    return this.cards.length;
  }

  /**
   * Redraw the whole scene, then hand back the grayscale the detector runs on —
   * produced from the very pixels just written, so there is no copy to go stale.
   */
  draw(placements: readonly CardPlacement[], gray: Uint8Array, grayWidth: number, grayHeight: number): Uint8Array {
    const bg = this.backgroundLuma;
    for (let i = 0; i < this.width * this.height; i++) {
      const o = i * 4;
      this.data[o] = bg; this.data[o + 1] = bg; this.data[o + 2] = bg; this.data[o + 3] = 255;
    }

    for (const placement of placements) this.drawCard(placement);

    this.provider.setPixels(0, 0, this.width, this.height, this.data);
    return this.toGray(gray, grayWidth, grayHeight);
  }

  /**
   * Inverse mapping: walk the destination area and pull from the source, which
   * avoids the holes a forward mapping leaves once rotation is involved.
   */
  private drawCard(placement: CardPlacement): void {
    const card = this.cards[placement.cardIndex % this.cards.length];
    const drawHeight = Math.max(4, Math.round(this.height * placement.heightFraction));
    const drawWidth = Math.max(3, Math.round(drawHeight * (card.width / card.height)));

    const centreX = placement.centreX * this.width;
    const centreY = placement.centreY * this.height;
    const rad = (placement.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // A rotated card needs a larger destination window than its own size.
    const reach = Math.ceil((Math.abs(drawWidth * cos) + Math.abs(drawHeight * sin)) / 2) + 1;
    const reachY = Math.ceil((Math.abs(drawWidth * sin) + Math.abs(drawHeight * cos)) / 2) + 1;

    const left = Math.max(0, Math.floor(centreX - reach));
    const right = Math.min(this.width - 1, Math.ceil(centreX + reach));
    const top = Math.max(0, Math.floor(centreY - reachY));
    const bottom = Math.min(this.height - 1, Math.ceil(centreY + reachY));

    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const dx = x - centreX;
        const dy = y - centreY;
        // Rotate the destination point back into card space.
        const localX = dx * cos + dy * sin;
        const localY = -dx * sin + dy * cos;
        if (Math.abs(localX) > drawWidth / 2 || Math.abs(localY) > drawHeight / 2) continue;

        const u = (localX + drawWidth / 2) / drawWidth;
        const v = (localY + drawHeight / 2) / drawHeight;
        const sx = Math.min(card.width - 1, Math.max(0, Math.floor(u * card.width)));
        const sy = Math.min(card.height - 1, Math.max(0, Math.floor(v * card.height)));

        const from = (sy * card.width + sx) * 4;
        const to = (y * this.width + x) * 4;
        this.data[to] = card.pixels[from];
        this.data[to + 1] = card.pixels[from + 1];
        this.data[to + 2] = card.pixels[from + 2];
        this.data[to + 3] = 255;
      }
    }
  }

  private toGray(gray: Uint8Array, outWidth: number, outHeight: number): Uint8Array {
    const xStep = this.width / outWidth;
    const yStep = this.height / outHeight;
    for (let y = 0; y < outHeight; y++) {
      const sy = Math.min(this.height - 1, Math.floor(y * yStep));
      const rowOffset = sy * this.width;
      const outRow = y * outWidth;
      for (let x = 0; x < outWidth; x++) {
        const sx = Math.min(this.width - 1, Math.floor(x * xStep));
        const i = (rowOffset + sx) * 4;
        gray[outRow + x] = (this.data[i] * 77 + this.data[i + 1] * 150 + this.data[i + 2] * 29) >> 8;
      }
    }
    return gray;
  }
}
