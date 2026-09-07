// Binder — data schema.
//
// Revised 2026-09-01 against the real Riftbound card shape. Five corrections to
// the original BINDER.md schema, each of which was a genuine modelling error:
//   1. A card has MANY domains (["Fury","Order"]), not one. Note that a card
//      with no colour uses the literal domain "Colorless" — not an empty list.
//   2. There is no single "cost": energy, might and power are separate, and any
//      of them may be null (a Legend has all three null).
//   3. supertype and rarity exist and are natural filter axes.
//   4. A printing id has three segments — "unl-116a-219" — and the middle one
//      carries the variant marker ("116a" alternate art, "229*" signature). The
//      collector number is therefore a STRING, never an integer.
//   5. Rules text and flavour text are separate fields. Merging them would put
//      flavour inside the "official rules text, verbatim" requirement.

export type Domain = string;        // sourced from card data, never hardcoded
export type CardType = 'unit' | 'spell' | 'gear' | 'rune' | 'legend' | 'battlefield';

export interface Card {
  /** Full printing id, e.g. 'unl-116a-219'. This identifies the PRINTING. */
  id: string;
  name: string;
  /** Set code, upper case, e.g. 'UNL'. */
  setCode: string;
  /** Collector number with any variant marker: '121', '116a', '229*'. */
  collectorNumber: string;
  type: CardType;
  supertype: string | null;         // e.g. 'Champion'
  rarity: string | null;            // e.g. 'Rare'
  /** One or more domains. "Colorless" is a domain, not an absence of one. */
  domains: Domain[];
  energy: number | null;
  might: number | null;
  power: number | null;
  /** Official English rules text, verbatim. Never flavour, never paraphrase. */
  text: string;
  flavourText: string | null;
  tags: string[];
  /**
   * Card art. Served from Riot's OWN CDN (cmsassets.rgpub.io) — the community
   * index links to it rather than rehosting it. Stored as a URL and fetched on
   * demand: the art is never bundled into the Lens, so nothing is redistributed.
   */
  imageUrl: string | null;
  artist: string | null;
  /**
   * Card orientation. Battlefields are LANDSCAPE (source art 1039x744);
   * everything else is portrait (744x1039). Rendering every card portrait
   * squashes battlefields, and it also breaks the detector's aspect test.
   */
  orientation: 'portrait' | 'landscape';
}

/** Everything card-data related goes through this. */
export interface CardSource {
  all(): Card[];
  byId(id: string): Card | null;
  /** Name-normalised index for fuzzy matching scan results. */
  search(query: string, limit: number): { card: Card; score: number }[];
}

/**
 * Deferred data sources. Both ship as null implementations in v1: every method
 * returns null and the UI hides the corresponding fields entirely. Adding real
 * prices or meta stats later is then a new implementation plus a config flag,
 * not a refactor. Never let either source influence deck validation.
 */
export interface PriceSource {
  /** Market price for a specific printing, in minor units. Null if unknown. */
  forPrinting(cardId: string): { amount: number; currency: string; asOf: number } | null;
  attribution(): string | null;     // feed's required credit line, rendered if present
}

export interface StatsSource {
  forCard(cardId: string): { playRate?: number; asOf: number } | null;
  attribution(): string | null;
}

export interface CollectionEntry {
  cardId: string;
  count: number;
  firstScannedAt: number;
}

export interface ScanResult {
  rawName: string;                  // exactly what the vision model read
  rawCollectorNumber: string | null;
  confidence: number;               // 0..1, from match score not the model
  matched: string | null;           // Card.id, null if below threshold
  alternatives: string[];           // up to 3 Card.ids, for disambiguation
}

export interface Deck {
  id: string;
  name: string;
  /**
   * The Champion Legend. Chosen FIRST: it sets the deck's domain identity, and
   * every other card must fit inside it (core rules 103.1.b.1).
   */
  legendId: string | null;
  /**
   * The Chosen Champion — a champion unit whose champion tag matches the
   * legend. It sits in the Champion Zone rather than the deck, but still counts
   * toward the 40-card minimum (103.2.a.2).
   */
  chosenChampionId: string | null;
  main: { cardId: string; count: number }[];
  runes: { cardId: string; count: number }[];
  battlefieldIds: string[];
  /**
   * Cards held back for swapping between games. Must be EXACTLY 8 or 0 — a
   * partial sideboard is not registerable, so "some" is the one wrong answer.
   */
  sideboard: { cardId: string; count: number }[];
  updatedAt: number;
}

export interface Violation {
  rule: string;                     // e.g. 'main.minimumSize'
  message: string;
  severity: 'error' | 'warning';
}

/** What the vision model is asked to return. Every field may be unreadable. */
export interface VisionTranscription {
  name: string | null;
  collectorNumber: string | null;
  setCode: string | null;
}
