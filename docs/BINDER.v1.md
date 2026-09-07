# Binder — a spatial collection scanner and deckbuilder for SPECS

Unofficial fan project for Riftbound: League of Legends Trading Card Game.
Drop this at the repo root. Claude Code reads it as the project contract.

## What we are building

A Lens for Snap Spectacles that reads your physical Riftbound cards through the
camera, builds a spatial collection wall from what you actually own, and lets you
build a deck by voice against that collection — then hands you a decklist and a
pull list for finding the cards in the box.

The problem it solves is not "deckbuilding is hard." Moxfield-style builders are
fast and good. The problem is that every digital builder assumes you already
typed in your collection, which nobody does, and that a finished list on your
phone still leaves you hunting forty cards in a shoebox. The cards are physically
in front of you and the glasses can see them. That is the entire reason this
belongs on a headset and not a laptop.

## Hard IP constraints — read before writing any feature

This project lives or dies by Riot's Riftbound digital tools policy. Violating
any of these is not a style question.

- **No gameplay.** No automated rules enforcement, no turn tracking, no life or
  score counters, no play simulation. Deckbuilding and collection management only.
  Riot explicitly encourages the latter and prohibits the former.
- **Card assets come from the Riot API only** — *amended 2026-09-01, see below.*
  Riot's policy states an App "may only use Riftbound assets (including cards)
  provided by the Riot API. No external or unofficial materials."

  **Amendment (owner decision, 2026-09-01):** because Riot has published no
  Riftbound card API and grants access only through an approved App-specific key,
  the project sources card data from **Riftcodex** (`api.riftcodex.com`, a
  community index not affiliated with Riot) in the interim. This is a knowing
  departure from the clause above, taken to unblock development.

  Conditions attached to it:
  - Card **art is never redistributed**. Only URLs are stored; images are fetched
    on demand from Riot's own CDN (`cmsassets.rgpub.io`), which is where
    Riftcodex points rather than rehosting.
  - The catalogue snapshot is regenerable (`node tools/fetch-cards.mjs`), so
    swapping to the Riot API is a new mapper plus a re-run, not a refactor.
  - **This must be resolved before the Riot key application.** Submitting a
    prototype built on non-Riot card data while requesting Riot card data is the
    single most likely reason for that application to be refused.
- **Prices — allowed, deferred.** Market prices are third-party market data, not a
  Riftbound asset, so the API-only rule does not cover them. The binding
  constraints come from the price feed's own terms. Out of v1 for scope reasons,
  not legal ones. Build behind `PriceSource`.
- **Metagame data — probably allowed, confirm first.** Riot's prohibition on
  metagame-defining data (deck and card play rates, win rates, matchup
  differentials) appears in a list scoped to apps that simulate or replicate
  gameplay, which this does not. The scoping is ambiguous and keys are granted at
  Riot's discretion, so confirm through the Developer Support Platform before
  shipping it, and keep it out of the initial key application. Build behind
  `StatsSource`.
- **Monetisation is possible** for an app that never simulates gameplay, holds an
  approved key, keeps a free tier, charges only for transformative content, and
  has no betting or gambling. Never any crypto or non-fiat currency.
- **Attribution.** The Lens and the README must both display the fan-project
  notice from Section 6 of Riot's Legal Jibber Jabber, copied verbatim from
  https://www.riotgames.com/legal. Do not paraphrase it.
- **Official rules only.** If the deck validator implements a Riftbound format,
  it must match the official construction rules exactly. No custom banlists, no
  house formats presented as official.

Keep all card data behind `CardSource` (below) so swapping the fixture set for the
real API is a one-file change when the key lands.

### API access — verified 2026-09-01

Checked directly against Riot's endpoints and the Riftbound Digital Tools Policy:

- **A Riftbound API exists, but only behind an App-specific approved key.** Riot's
  policy: securing that key "will require your App to integrate with Riot's
  application programming interface... the Riot API will give you authorized
  access to select Riftbound assets—including card art, rulesets, and other
  materials." A generic `RGAPI-` development key does **not** reach them: it
  returns 200 on LoL / TFT / LoR endpoints and 403 on every Riftbound path.
- **No public Riftbound card CDN.** There is no equivalent of LoL's Data Dragon
  or LoR's `dd.b.pvp.net`; the plausible hostnames do not resolve.
- **Community sources are ruled out**, not merely discouraged. Policy: an App
  "may only use Riftbound assets (including cards) provided by the Riot API. No
  external or unofficial materials." That excludes Riftcodex, API TCG and every
  other third-party card database.
- **Approved use cases confirmed.** "Deckbuilders" and "card libraries" are named
  as approved; Binder is both and simulates no gameplay, so it also needs no RSO
  integration (RSO is required only for Apps that replicate gameplay).
- **Metagame-data prohibition confirmed as scoped** to Apps that simulate or
  replicate gameplay, as this document assumed. Still confirm before shipping.
- **Applying does not require a finished App** — "a working prototype or detailed
  mock-up that clearly expresses your product's purpose and the user flow" is
  accepted. Phases 0-2 are that prototype.

Consequence: fixtures are the only compliant card source until an App-specific
key is approved, and the current `DEV` fixture cards are invented placeholders
that must not appear in any build shown to Riot or to players.

## Platform

- Lens Studio 5.22+, SPECS project, TypeScript.
- Camera frames via Camera Module; vision and text calls via Remote Service
  Gateway. Token in `RemoteServiceGatewayCredentials`, **never committed**.
- No npm dependencies.
- World-space units in this document are **centimetres**; convert at the Lens
  Studio boundary.

---

## Data schema

```ts
export type Domain = string;        // sourced from card data, never hardcoded
export type CardType = 'unit' | 'spell' | 'gear' | 'rune' | 'legend' | 'battlefield';

export interface Card {
  id: string;                       // `${setCode}-${collectorNumber}`
  name: string;
  setCode: string;
  collectorNumber: string;
  type: CardType;
  domain: Domain | null;
  cost: number | null;
  text: string;                     // official English text, verbatim
  tags: string[];
}

/** Everything card-data related goes through this. Fixture now, Riot API later. */
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
  legendId: string | null;
  main: { cardId: string; count: number }[];
  runes: { cardId: string; count: number }[];
  battlefieldIds: string[];
  updatedAt: number;
}

export interface Violation {
  rule: string;                     // e.g. 'main.minimumSize'
  message: string;
  severity: 'error' | 'warning';
}
```

### Deck validation

`validate(deck, source): Violation[]`.

**Do not hardcode the construction rules from memory.** Riftbound uses a main deck
plus a separate rune deck, a champion legend, and battlefields, with sizes and
copy limits set by format. Pull the authoritative numbers from the Riot API
ruleset or the official rules document and put them in `Rules.ts` with a source
comment and a date. If a number cannot be verified, mark the rule
`severity: 'warning'` and label it unverified in the UI rather than asserting it.

---

## Identification pipeline

The single most important architectural decision: **do not track cards
continuously, and do not train a model.**

Every card is the same rectangle, so shape tracking tells you nothing about
identity, and identity needs reading, not detection. A 1,200-class classifier is
weeks of work and breaks on every set release.

Instead:

1. **Scan gate.** A world-anchored frame, roughly 20cm tall, floating at a
   comfortable holding distance. The user holds a card into it. UI is anchored to
   the gate in world space, never to the card, which removes the tracking problem
   entirely.
2. **Trigger** on a still-hold: frame-to-frame difference under threshold for
   400ms, or the `SCAN` voice intent.
3. **Vision call** through Remote Service Gateway. Send the cropped gate region.
   Prompt asks for JSON only: `{ name, collectorNumber, setCode }`, transcribing
   the printed text exactly, with nulls where unreadable. No guessing, no
   knowledge of the game — pure transcription.
4. **Match locally.** Exact collector number plus set code wins outright. Otherwise
   normalised Levenshtein on the name against `CardSource.search`. Threshold 0.82
   for auto-accept; below that, surface the top 3 as alternatives and let the user
   say "the second one".
5. **Cache** by collector number. A rescan of a known card is instant and
   increments `count`.

Prefer the collector number over the name wherever it is legible — the name
identifies a card, the number identifies the printing.

Unrecognised scans go to a visible "unmatched" tray, never silently dropped.

---

## Spatial layout

Two walls plus a focus slot. All auto-arranged; the user never drags anything.

```
collection wall   240 x 160 cm, anchored left, 250 cm from user
deck wall         180 x 160 cm, anchored 40 deg to the right of the collection wall
tile              7.2 x 10 cm  (card aspect), 2 cm gutter
grid              20 cols x 10 rows = 200 visible tiles, voice-paged
focus slot        centred between the walls, card rendered 25 cm tall
scan gate         14 x 20 cm, 45 cm from the user, below the focus slot
```

**Legibility strategy — the focus card, not distance LOD.** Card rules text cannot
be usefully abbreviated, so do not try. Tiles show art region, name, cost and
domain colour only. Gazing a tile renders that card at 25cm in the focus slot,
where the full official text is readable. One card readable at a time is correct
here; a wall of readable cards is not achievable and not needed.

Deck wall groups the main deck into columns by cost, so the curve is the layout
rather than a separate chart.

---

## Interaction

Gaze targets, voice acts, hands do almost nothing.

| Intent      | Utterances                                  | Needs gaze |
|-------------|---------------------------------------------|-----------|
| `SCAN`      | "scan", or automatic on still-hold          | no        |
| `ADD`       | "add", "add three"                          | yes       |
| `REMOVE`    | "remove", "take one out"                    | yes       |
| `FILTER`    | "show units under four", "only <domain>"    | no        |
| `CLEAR`     | "show everything"                           | no        |
| `PICK`      | "the second one" (scan disambiguation)      | no        |
| `EXPORT`    | "export", "save the list"                   | no        |

`FILTER` is parsed by an LLM call into a structured predicate over `Card` fields,
then applied locally. Never let the model choose cards — it parses the query, the
local code filters. Riftbound is newer than most model training data and the model
does not know these cards.

Hands: pinch-drag repositions a wall. Nothing else. No card dragging.

**Debug fallback, built in Phase 0.** Every intent fires from a tap panel with
identical payloads, and `SCAN` accepts a canned image. Voice and camera both fail
on demo day; the recorded video must be able to run without either.

---

## Export

Two artifacts, because both are the point:

1. **Decklist** — plain text, one card per line with counts, legend and runes
   separated. Must round-trip: an exported list re-imports to the same `Deck`.
2. **Pull list** — the same cards grouped by set and collector number in ascending
   order, which is the order you flip through a sorted box. This is the bridge back
   to the physical cards and it is the feature nobody else has.

---

## Build order

Do not start a phase before the previous one runs in Spectacles Preview.

- **Phase 0** — `Card`, `CardSource` with a hand-entered fixture set of ~20 cards,
  collection wall renderer, focus slot, tap debug panel. No camera, no AI.
- **Phase 1** — Scan gate: camera frame, still-hold trigger, vision call, fuzzy
  match, card flies to the wall. Canned-image path first, live camera second.
- **Phase 2** — Deck wall, `ADD`/`REMOVE` by gaze plus voice, cost-column layout.
- **Phase 3** — `validate()` against `Rules.ts`, violations surfaced on the deck wall.
- **Phase 4** — `FILTER` parsing and local filtering.
- **Phase 5** — Export decklist and pull list.
- **Phase 6** — Stretch: one frame containing several spread cards, all identified
  in a single vision call. Attempt only if Phases 0–5 are solid.

Phases 0–2 are the minimum viable demo. Phase 5 is what makes it a tool rather
than a toy.

## Tests

- `CardSource.search` returns the right card for exact names, for names with one
  character of OCR noise, and returns low scores for genuine non-matches.
- Collector-number match beats a conflicting name match.
- Scan below threshold produces alternatives and never auto-adds.
- Duplicate scan increments `count` rather than creating a second entry.
- Layout: no two tiles overlap; the grid stays inside wall bounds; paging is
  stable when the collection grows mid-session.
- `validate()` has one test per rule in `Rules.ts`.
- Decklist export round-trips to an identical `Deck`.
- Vision response parsing survives fenced JSON, trailing prose, and truncation.

## Non-goals

Gameplay of any kind — that one is permanent. Continuous card tracking. Trained
card-recognition models. Hand-dragged layout. More than one deck open at a time.
Multiplayer.

Deferred, not forbidden: prices and metagame stats. Both have interfaces defined
above and null implementations in v1. Do not build either this week, and do not
mention either in the Riot key application.

## Style

TypeScript, strict, no `any` in the schema layer. Layout, matching, and validation
are pure functions testable without the Lens Studio runtime. All tunable numbers —
wall dimensions, tile size, match threshold, still-hold duration — live in
`Config.ts`, because every one of them will change once it is on a face.
