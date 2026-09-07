// Binder — fetch card art as textures. Lens runtime.
//
// Art is fetched on demand from Riot's CDN and cached in memory for the
// session. Nothing is written to disk and nothing is bundled into the Lens.
//
// Requests are keyed by the exact sized URL, so the focus slot's 512px request
// and a tile's 160px request of the same card are separate cache entries — as
// they should be, since they are different textures.

import type { Card } from '../Core/Types';
import { cardArtUrl, ArtSize } from '../Core/CardArt';

type Pending = ((texture: Texture | null) => void)[];

interface QueuedRequest { url: string; cardId: string }

/** A wall of tiles would otherwise open one connection per tile at once. */
const MAX_IN_FLIGHT = 6;

export class CardArtLoader {
  private readonly cache = new Map<string, Texture>();
  private readonly pending = new Map<string, Pending>();
  private readonly queue: QueuedRequest[] = [];
  private inFlight = 0;

  constructor(
    private readonly internet: InternetModule,
    private readonly media: RemoteMediaModule,
  ) {}

  /**
   * Resolve art for a card. The callback receives null — never an exception —
   * when the card has no art or the fetch fails, so callers keep the flat
   * domain colour instead of rendering a broken texture.
   */
  load(card: Card, size: ArtSize, done: (texture: Texture | null) => void): void {
    const url = cardArtUrl(card, size);
    if (url === null) { done(null); return; }

    const cached = this.cache.get(url);
    if (cached !== undefined) { done(cached); return; }

    // Coalesce: a second request for the same URL waits on the first rather
    // than starting a duplicate download.
    const waiting = this.pending.get(url);
    if (waiting !== undefined) { waiting.push(done); return; }
    this.pending.set(url, [done]);

    this.queue.push({ url, cardId: card.id });
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const next = this.queue.shift() as QueuedRequest;
      this.inFlight++;
      this.start(next);
    }
  }

  private start(request: QueuedRequest): void {
    const resource = this.internet.makeResourceFromUrl(request.url);
    this.media.loadResourceAsImageTexture(
      resource,
      (texture) => {
        this.cache.set(request.url, texture);
        this.finish(request.url, texture);
      },
      (error) => {
        console.warn(`[Binder] art failed for ${request.cardId}: ${error}`);
        this.finish(request.url, null);
      },
    );
  }

  private finish(url: string, texture: Texture | null): void {
    this.inFlight--;
    this.settle(url, texture);
    this.pump();
  }

  private settle(url: string, texture: Texture | null): void {
    const waiting = this.pending.get(url);
    this.pending.delete(url);
    if (waiting === undefined) return;
    for (const callback of waiting) callback(texture);
  }
}
