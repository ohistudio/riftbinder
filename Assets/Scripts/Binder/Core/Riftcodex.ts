// Binder — Riftcodex response -> Card mapping. Pure, no runtime, no network.
//
// Kept separate from whatever performs the HTTP so the mapping is testable
// against captured payloads, and so replacing Riftcodex with Riot's own API
// later means writing a sibling mapper rather than touching anything else.

import type { Card, CardType } from './Types';

/** The subset of the Riftcodex card object Binder consumes. */
export interface RiftcodexCard {
  riftbound_id?: string | null;
  name?: string | null;
  collector_number?: number | string | null;
  attributes?: { energy?: number | null; might?: number | null; power?: number | null } | null;
  classification?: {
    type?: string | null;
    supertype?: string | null;
    rarity?: string | null;
    domain?: string[] | null;
  } | null;
  text?: { plain?: string | null; flavour?: string | null } | null;
  set?: { set_id?: string | null; label?: string | null } | null;
  tags?: string[] | null;
  media?: { image_url?: string | null; artist?: string | null } | null;
  orientation?: string | null;
}

const CARD_TYPES: CardType[] = ['unit', 'spell', 'gear', 'rune', 'legend', 'battlefield'];

/** 'Unit' -> 'unit'. Returns null for a type Binder does not model. */
export function parseCardType(raw: string | null | undefined): CardType | null {
  if (raw === null || raw === undefined) return null;
  const lowered = raw.trim().toLowerCase();
  return CARD_TYPES.indexOf(lowered as CardType) === -1 ? null : (lowered as CardType);
}

/**
 * 'unl-116a-219' -> { setCode: 'UNL', collectorNumber: '116a' }.
 *
 * The middle segment keeps its variant marker: '116a' is the alternate art and
 * '229*' the signature printing, and those are different printings of the same
 * card. Dropping the marker would silently merge them in the collection.
 */
export function parseRiftboundId(
  riftboundId: string,
): { setCode: string; collectorNumber: string } | null {
  const parts = riftboundId.split('-');
  if (parts.length < 2) return null;
  const setCode = parts[0].trim().toUpperCase();
  const collectorNumber = parts[1].trim();
  if (setCode === '' || collectorNumber === '') return null;
  return { setCode, collectorNumber };
}

function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && isFinite(value) ? value : null;
}

function str(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Map one Riftcodex card. Returns null — rather than a half-built Card — for
 * anything missing an id, a name or a modellable type, so a bad row is dropped
 * loudly at import time instead of surfacing as an empty tile on the wall.
 */
export function mapRiftcodexCard(raw: RiftcodexCard): Card | null {
  const id = str(raw.riftbound_id);
  const name = str(raw.name);
  if (id === null || name === null) return null;

  const type = parseCardType(raw.classification?.type);
  if (type === null) return null;

  const parsed = parseRiftboundId(id);
  if (parsed === null) return null;

  // Prefer the id's collector segment: it carries the variant marker that the
  // numeric collector_number field has already thrown away.
  const fallbackNumber = raw.collector_number;
  const collectorNumber = parsed.collectorNumber !== ''
    ? parsed.collectorNumber
    : fallbackNumber === null || fallbackNumber === undefined ? '' : String(fallbackNumber);

  const domains = (raw.classification?.domain ?? [])
    .map((d) => (typeof d === 'string' ? d.trim() : ''))
    .filter((d) => d !== '');

  return {
    id,
    name,
    setCode: str(raw.set?.set_id)?.toUpperCase() ?? parsed.setCode,
    collectorNumber,
    type,
    supertype: str(raw.classification?.supertype),
    rarity: str(raw.classification?.rarity),
    domains,
    energy: num(raw.attributes?.energy),
    might: num(raw.attributes?.might),
    power: num(raw.attributes?.power),
    text: str(raw.text?.plain) ?? '',
    flavourText: str(raw.text?.flavour),
    tags: (raw.tags ?? []).filter((t) => typeof t === 'string' && t.trim() !== ''),
    imageUrl: str(raw.media?.image_url),
    artist: str(raw.media?.artist),
    // Battlefields are landscape; default to portrait for anything unlabelled.
    orientation: str(raw.orientation)?.toLowerCase() === 'landscape' ? 'landscape' : 'portrait',
  };
}

/** Map a whole page, dropping unmappable rows. */
export function mapRiftcodexPage(items: readonly RiftcodexCard[]): Card[] {
  const cards: Card[] = [];
  for (const raw of items) {
    const card = mapRiftcodexCard(raw);
    if (card !== null) cards.push(card);
  }
  return cards;
}
