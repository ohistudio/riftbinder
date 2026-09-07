// Binder — card art URLs. Pure, no runtime, no network.
//
// Card art lives on Riot's own CDN (cmsassets.rgpub.io), which is a Sanity
// image endpoint and therefore honours ?w= and ?fm= transform parameters. That
// matters enormously here: the full-size PNG is ~1.4 MB, while w=160&fm=webp is
// ~10 KB. Requesting the size actually needed is the difference between a wall
// of art being impossible and being cheap.
//
// Nothing is ever bundled into the Lens — these are fetch-on-demand URLs.

import type { Card } from './Types';

/**
 * Source art dimensions. Battlefields are LANDSCAPE — 1039x744, the reverse of
 * everything else — so a single hardcoded portrait aspect squashes them.
 */
export const PORTRAIT_ASPECT = 744 / 1039;
export const LANDSCAPE_ASPECT = 1039 / 744;

/** Kept for callers that only ever draw portrait cards. */
export const CARD_ART_ASPECT = PORTRAIT_ASPECT;

/** Width-over-height for this specific card. */
export function aspectOf(card: { orientation: 'portrait' | 'landscape' }): number {
  return card.orientation === 'landscape' ? LANDSCAPE_ASPECT : PORTRAIT_ASPECT;
}

export interface ArtSize {
  /** Requested width in pixels. Height follows the card aspect. */
  widthPx: number;
  /** JPEG quality 1-100. Omitted leaves the CDN default (~75). */
  quality?: number;
}

/**
 * Native width of the source art. Requesting more just upscales — w=1024 costs
 * 281 KB against 189 KB at native 744 and carries no extra detail.
 *
 * Landscape cards are 1039 wide, so clamping everything to 744 would needlessly
 * soften battlefields.
 */
export const MAX_SOURCE_WIDTH = 744;
export const MAX_SOURCE_WIDTH_LANDSCAPE = 1039;

export function maxSourceWidth(card: { orientation: 'portrait' | 'landscape' }): number {
  return card.orientation === 'landscape' ? MAX_SOURCE_WIDTH_LANDSCAPE : MAX_SOURCE_WIDTH;
}

/**
 * Image format requested from the CDN.
 *
 * NOT webp. Lens Studio's texture decoder does not handle WebP and — worse —
 * fails silently: loadResourceAsImageTexture calls neither the success nor the
 * failure callback, so the request simply hangs forever with no error anywhere.
 *
 * JPEG is the right default. Measured on a real card at 744x1039 source:
 *   w=160  png 95 KB  |  jpg  9 KB
 *   w=512  png 683 KB |  jpg 61 KB
 * A tenfold saving, which is what makes art on a full wall of tiles affordable.
 */
export type ArtFormat = 'png' | 'jpg';
export const ART_FORMAT: ArtFormat = 'jpg';

/**
 * Wall tiles. 320px on a 7.2cm tile is ~30 KB; a full 200-tile page is then
 * ~6 MB of texture, which is the real ceiling on tile quality rather than
 * bandwidth. 160px was noticeably soft.
 */
export const TILE_ART: ArtSize = { widthPx: 320, quality: 80 };

/**
 * Focus slot. Native resolution at high quality (~189 KB) — this is the one
 * card the user is actually reading, so it gets everything the source has.
 */
export const FOCUS_ART: ArtSize = { widthPx: MAX_SOURCE_WIDTH, quality: 90 };

/**
 * Build a sized art URL. Returns null when the card has no art, so callers
 * fall back to the flat domain colour rather than requesting a broken texture.
 */
export function cardArtUrl(card: Card, size: ArtSize, format: ArtFormat = ART_FORMAT): string | null {
  if (card.imageUrl === null || card.imageUrl.trim() === '') return null;
  const width = Math.min(maxSourceWidth(card), Math.max(1, Math.round(size.widthPx)));
  const separator = card.imageUrl.indexOf('?') === -1 ? '?' : '&';
  const quality = size.quality === undefined ? '' : `&q=${Math.min(100, Math.max(1, Math.round(size.quality)))}`;
  return `${card.imageUrl}${separator}w=${width}&fm=${format}${quality}`;
}
