# Binder — a spatial deckbuilder for SPECS

Unofficial fan project for Riftbound: League of Legends Trading Card Game.

> **Theme:** build a spatial tool that helps people create something faster,
> easier, or more intuitively.
>
> Revised 2026-09-01. The original contract is preserved at
> `docs/BINDER.v1.md`; § Direction change records what moved and why.

## What we are building

A Lens for Snap Specs that turns deckbuilding into something you do with your
hands, your voice, and the cards already on the table in front of you.

Three things working together:

1. **An AI agent you talk to.** "I want a Fury aggro deck." "What goes with this
   legend?" "Something cheaper than this." It suggests real cards from the real
   card pool and explains why.
2. **Search that keeps up with speech.** "Show me units under four." "Only Calm."
   Spoken, parsed, applied instantly against the local catalogue.
3. **A deck you build in space.** Cards arranged around you, grouped by cost so
   the curve *is* the layout, not a chart you go and look at.

And the part that only works on a headset: **point at a physical card and it
joins the session.** Not typed in, not searched for — picked up and recognised.

The thing being created is a deck. The claim is that saying "give me something
that trades up against three-drops" and seeing four real candidates appear in
front of you is faster and more intuitive than filtering a table on a laptop.

## Hard IP constraints — read before writing any feature

Riot's Riftbound digital tools policy. These are not style questions, and they
did not change with the direction.

- **No gameplay.** No automated rules enforcement, no turn tracking, no life or
  score counters, no play simulation. Deckbuilding and collection management
  only — Riot names "deckbuilders" and "card libraries" as approved use cases.

  **This binds the card-anchored UI specifically.** Overlaying ownership, deck
  membership, or synergy on a physical card is collection management. Overlaying
  *game state* — exhausted/ready, damage, counters, whose turn — is automated
  rules enforcement. The technical capability is identical; only what is drawn
  differs. Decide deliberately, because this drifts toward a play assistant by
  gravity.
- **No metagame-defining data.** The AI agent reasons about synergy, curve and
  domain fit. It must not reason about, display, or retain play rates, win rates
  or matchup differentials. Riot scopes this prohibition to apps that simulate
  gameplay — which this does not — but keys are granted at Riot's discretion,
  so confirm through the Developer Support Platform before shipping any of it
  and keep it out of the initial key application.
- **Card assets come from the Riot API only** — *amended, see § Card data.*
- **Attribution.** The Lens and the README must display the notice from Section 6
  of Riot's Legal Jibber Jabber, verbatim. `Core/Attribution.ts` is the single
  source of truth: README.md quotes it and the main menu renders it as fine
  print at the foot of the panel — the home screen is "clear and easy to find",
  and it is out of the way while building. It previously floated below every
  panel, was removed as clutter, and for a while this document claimed it was
  rendered when nothing referenced the constant at all. A test now pins the
  wording so it cannot be paraphrased.
- **Official rules only.** If the validator implements a Riftbound format it must
  match the official construction rules exactly. No custom banlists.
- **Monetisation is possible** for an app that never simulates gameplay, holds an
  approved key, keeps a free tier, charges only for transformative content, and
  has no betting, gambling, or non-fiat currency.

## Card data

Riot has published no official Riftbound card API; access requires an
**App-specific approved key**. Verified 2026-09-01: a generic `RGAPI-` key
returns 200 on LoL/TFT/LoR endpoints and 403 on every Riftbound path, and no
public Riftbound card CDN exists.

**Amendment (owner decision, 2026-09-01):** card data is sourced from
**Riftcodex** (`api.riftcodex.com`), a community index not affiliated with Riot.
This is a knowing departure from "Riot API only", taken to unblock development.
Conditions:

- Card **art is never redistributed** — only URLs are stored, and images stream
  from Riot's own CDN (`cmsassets.rgpub.io`) at the size actually needed.
- The snapshot is regenerable: `node tools/fetch-cards.mjs`.
- **This must be resolved before the Riot key application.** Submitting a
  prototype built on non-Riot card data while requesting Riot card data is the
  likeliest single reason for refusal.

All reads go through `CardSource`, so a `RiotCardSource` is a new mapper plus a
regeneration, never a refactor.

## Platform

- Lens Studio 5.22+, SPECS project, TypeScript strict, no `any` in the schema.
- Camera via Camera Module; Gemini via **Remote Service Gateway**; speech via the
  **ASR Module**. Tokens in `RemoteServiceGatewayCredentials`, **never committed**.
- No npm dependencies.
- World units in this document are **centimetres**. Rotations are degrees in the
  Editor API, radians at runtime.
- Every tunable lives in `Config.ts`, because all of them change once it is on a
  face.

## Grounding — the rule that makes or breaks the agent

**Gemini does not know Riftbound.** The game is newer than the training data, and
a model asked to suggest a card will invent plausible ones that do not exist.
Two different jobs, two different rules:

| Job | Who decides | Why |
|---|---|---|
| **Search / filter** | Model parses the phrase into a structured predicate; **local code filters** | Deterministic. Cannot hallucinate a card. |
| **Suggestion** | Local code retrieves candidates; **model ranks and explains only those** | The model needs real cards in front of it or it fabricates them. |

A suggestion prompt must contain the actual candidate cards — name, cost,
domains, text — retrieved locally from the catalogue. The model never names a
card from memory. If a response mentions a card id not in the candidate set,
drop it; do not display it.

## Data schema

See `Assets/Scripts/Binder/Core/Types.ts`, which is authoritative and carries the
reasoning inline. Shape, verified against real card data:

- `Card` — three-segment printing `id` (`unl-116a-219`, the middle segment
  carrying variant markers), `domains: Domain[]` (multi-domain is normal;
  "Colorless" is a domain, not an absence), separate `energy`/`might`/`power`
  (any may be null), `supertype`, `rarity`, rules `text` and `flavourText` kept
  apart, `imageUrl`/`artist`.
- `CardSource` — `all` / `byId` / `search`. The only seam to card data.
- `Deck`, `CollectionEntry`, `ScanResult`, `Violation` — as before.
- `PriceSource` / `StatsSource` — deferred, null implementations. Never allowed
  to influence deck validation.

### Deck construction — VERIFIED 2026-09-01

Sources: [Rift Watcher core-rules reference](https://riftwatcher.com/rules/deck-construction/)
(citing rules 103.1-103.4) and
[riftbound.gg Deckbuilding 101](https://riftbound.gg/deckbuilding-101-building-your-first-riftbound-deck/).
These are no longer placeholders — they are in `Rules.ts` with rule numbers, and
they report as ERRORS. Anything still unverified stays a warning and says so.

| Rule | Value | Status |
|---|---|---|
| Main deck | at least 40, **including the Chosen Champion** (103.2) | verified |
| Sanctioned constructed | exactly 40 | warning — not a core rule |
| Copies of one named card | 3, champion included (103.2.b) | verified |
| Rune deck | 12 (103.3.a) | verified |
| Battlefields | unique names (103.4.c); count set by Mode of Play (103.4.a) | uniqueness verified, count is a warning |
| Signature cards | 3 sharing the legend's tag (103.2.d) | verified |
| Off-tag signature card | not allowed | warning — the rule text does not say it outright |

**Panel styling.** The surface is a UIKit `BackPlate` with a four-stop gradient
(`Runtime/UIKitUtils.ts`), kept DARK on purpose — an additive display adds
light, so a bright panel is an opaque one, and the first attempt at this
gradient turned every panel into a lavender slab you could not see the room
through. The shape is carried by a rim instead: `Runtime/PanelBorder.ts` builds
a rounded-rectangle ring with `MeshBuilder` and hangs it on every panel from
inside `makeBackPlate`, so all nine get it or none do. Two things that cost real
time and are worth knowing: the ring must be wound so its normals face +Z or
every triangle is back-face culled (it still builds, reports `valid`, attaches,
and draws nothing), and it must sit at z 0.62 — in FRONT of the BackPlate's
~1cm-thick body, not merely proud of it. The rim is a single flat colour: the
bundled vertex-colour material rendered invisibly, so the mesh still carries
per-vertex colours but the unlit material ignores them. A gradient rim would
need that material debugged or the ring split into segments.

**Colouring a UIKit button's face: use the GRADIENT setters, not baseColor.**
The button style paints `baseType: "Gradient"`, so `visual.baseDefaultColor`
is accepted, stored, and then ignored by the shader — setting it looks like it
works and changes nothing on screen, which a magenta probe proved in one run.
`visual.defaultGradient` / `hoveredGradient` / `triggeredGradient` are what
reach the pixels. Set all three: colouring only the default leaves the theme's
grey hover, so the button changes hue under your gaze and reads as a glitch.

**Buttons are outlined AND filled.** UIKit's button styles are neutral greys
picked against a grey theme; on the darker panel the labels floated with no
sense of a pressable edge. Tinting the fill means writing UIKit's per-state
private colour map, which is re-applied on every hover — an outline is a plain
mesh no state change can undo, so the two are used together — rim for the edge,
gradient for the face. `addButtonRim` is exported because FOUR views
build their `Button` separately (`MainMenuView`, `DebugPanel`, `DeckLibraryView`
and `makeButton`), and rims on only some of them looked like a rendering fault.
**The controls strip follows the panel it serves.** It was sized once from the
card grid, so on the narrower screens — your decks, the store finder — it hung
out past both edges of the panel below which it sits. `setPanelWidth` resizes
the strip AND every button in it: the faces, their rims and the labels' boxes
were all built at the old width, so moving them alone left wide buttons
overlapping inside a narrow strip. The rows are also centred on the plate
rather than hung from its top, which is what put a third row outside its own
border. The `handle` palette entry now paints the grab bar; it used to use `accent`,
which meant brightening the highlight colour turned every panel's bar into a
slab as loud as the thing it was meant to highlight.

**Feel.** Every button presses back — a sound and a quick squash — through one
hook (`setButtonPressFeedback` in `Runtime/UIKitUtils.ts`) that all four
button-building sites route through, because before it exactly ONE press in the
app made a sound and on an additive display a silent button has no travel to
feel. Gaze landing on a card ticks (`hover_tick.wav`, three voices so a sweep
across a row drops none); a card landing in the deck snaps into its sleeve
(`card_slot.wav`) and pulses the status panel, but only when the deck actually
grew; and the deck turning legal — the moment the build works towards — plays
the success chime once, on the crossing, not on every later edit. `Juice.pulse`
is the press; `Juice.popIn` is arrival; they are kept distinct on purpose.

**Signature cards are the supertype, not the printing.** Riftcodex exposes two
unrelated things under the same word, and picking the wrong one silently
produces a rule that can never fire. `classification.supertype === 'Signature'`
is the gameplay class 103.2.d means: 61 Spell/Unit/Gear cards, each tagged with
the champion they belong to. `metadata.signature` is the `229*` collector
printing of a LEGEND — 36 cards, zero overlap with the first set, and no legend
is ever in a main deck. This backlog item sat blocked for a while on the belief
that the catalogue lacked the field; it had carried `supertype` all along.

**The build has an order, and it is not cosmetic.**

1. **Champion Legend first.** It fixes the deck's Domain Identity (103.1.b.1),
   so nothing else can be judged legal until it exists.
2. **Chosen Champion.** A champion unit whose tag matches the legend
   (103.2.a.2). It sits in the Champion Zone rather than the deck, but counts
   toward the 40 — so `Deck.chosenChampionId` is separate from `main` and
   `mainDeckSize()` adds it.
3. **Battlefields** — three, each a different name (103.4.c). They carry no
   domain, so identity does not narrow them.
4. **Runes** — twelve, all inside the legend's identity. The least interesting
   decision in the build, so `autoFillRunes` splits them evenly across the
   legend's domains on request.
5. **The main deck**, constrained by that identity.

`stageOf(deck)` returns `legend | champion | battlefields | runes | deck`. Only
the first two are true gates; the rest are ordered because they are quick and
constrained, leaving the open-ended 40-card choice for last. Changing legend
clears a Chosen Champion that no longer matches.

**Battlefields are LANDSCAPE.** Source art is 1039x744, the reverse of every
other card. `Card.orientation` carries it, `aspectOf()` drives sizing in the
wall tiles, the agent panel AND the focus slot, and `maxSourceWidth()` stops
them being clamped to the portrait width and needlessly softened. Rendering
everything portrait squashes all 71 of them; sizing them to a portrait slot
pitch letterboxes them into a sliver, so the agent panel shares out the row's
full width by how many cards it is actually showing.

**Sideboard** — exactly 8 or 0; "some" is the one wrong answer. `Deck.sideboard`
carries it, cards move both ways with `toSideboard`/`fromSideboard`, sideboard
cards obey the legend's domain identity (they enter play), and the pull list
counts them because you still have to find them. Unverified: 8-or-0 comes from
community guidance, not the numbered core rules, so it reports as a warning.

**Not modelled:** the bench scratchpad.

**Domain identity is stricter than it looks.** A card must have ALL of its
domains inside the legend's identity — a Fury/Chaos card is illegal in a
Fury/Order deck despite sharing Fury. The first implementation used "shares any
domain", which silently admitted illegal cards. Colourless is treated as
identity-free (an assumption, not verified).

Note that SEARCH deliberately keeps the looser "has any of these domains"
meaning: looking for Calm cards should find a Fury/Calm card even though it
could not go in a Fury deck.

`validate(deck, source): Violation[]` reports and never blocks — BINDER.md
§ Hard IP constraints forbids automated rules enforcement, and silently refusing
an edit is enforcing rather than informing.

## Identification — physical cards

Superseded design. The original scan gate assumed identity had to be established
by careful reading in a fixed frame. It does not.

1. **Detect** a card-shaped quad in the camera frame. Classical CV, no model.
2. **Assign a tracker id.** Session-local and arbitrary — *it does not matter
   which card it is for tracking purposes*, only that the tracker is unique and
   stable while visible. This removes frame-to-frame re-identification entirely.
3. **Identify once** via Gemini vision: crop the quad, ask for JSON only —
   `{ name, collectorNumber, setCode }` — transcribing printed text exactly,
   nulls where unreadable. No guessing, no game knowledge.
4. **Match locally** against the catalogue. Exact collector number plus set code
   wins outright; otherwise normalised Levenshtein on the name, threshold 0.82 to
   auto-accept, top 3 as alternatives below it. Implemented in `Core/Matching.ts`.
5. **Bind** identity to the tracker id. UI then follows the tracker.

Losing the tracker (occlusion, out of frame) discards the binding and re-runs
step 3. That is acceptable: identification is one call, not a per-frame cost.

Prefer the collector number over the name wherever legible — the name identifies
a card, the number identifies the printing. Unrecognised scans go to a visible
"unmatched" tray, never silently dropped.

## Spatial layout

A workbench, not a surround. **The Specs field of view is ~36 degrees**: at one
metre you can see roughly 60 cm of width, so exactly one panel can hold the
centre and everything else is a deliberate glance.

```
agent panel      centred, 95 cm      four suggested cards as ART, not prose
focus card       30 deg left, 105 cm the card currently under attention
deck status      30 deg right, 105cm counts, energy curve, validation
collection wall  46 deg left, 190 cm 12 x 6 tiles, voice-paged
deck wall        46 deg right, 190cm main deck in energy columns
controls         below centre, 82 cm tap fallback for every intent
attribution      foot of the main menu, fine print, required Riot notice
```

These numbers REPLACE the ones originally in this document (240x160 walls at
250 cm, a 20x10 grid, 40 degrees apart). That layout assumed a far wider FOV:
a 240 cm wall at 250 cm overflows the view, so the grid could never be seen
whole, and walls 40 degrees apart sat on top of the working area. The
replacement is sized so each surface fits in one glance.

Tiles render the **full card face** — Riftbound art is the whole card, so name,
cost and rules text come printed on it, and the icon tokens that appear in
transcribed text (`:rb_exhaust:`) are real icons. Art streams from Riot's CDN,
sized per use: 320px for tiles, native 744px for the focus card.

Deck wall groups the main deck into columns by **energy**, so the curve is the
layout. Energy is the deckbuilding cost; might and power are combat stats and do
not belong on that axis. The deck status panel repeats the curve as bars,
because while you are talking to the agent the wall is a head-turn away.

**The card panel SCROLLS; it does not page.** Paging tied the visible tile count
to the size of the pool, and every tile carries a collider and an Interactable —
at 200 the preview stopped responding to input entirely. Scrolling breaks that
link: 180 legends move through 32 slots (8 x 4). Masking is done by CULLING
rather than a stencil — a tile whose row has left the panel is disabled, so
nothing draws past the edge. Tiles vanish a row early instead of being clipped
mid-way, which is the honest trade for not having a real mask.

**Browse locally; ask the model only what needs judgement.** There are ~180
legends and the whole catalogue is already on the device. Choosing a legend is a
browse-and-decide task, so it is a local grid on the collection wall — every
option, instantly, no round trip. The agent is for "what fits the deck I am
building", which is judgement. `Core/Browse.ts` owns the pool and the agent
narrows that same pool, so the two can never drift into offering different
cards.

**No tier list.** Ranking legends or decks by strength is metagame-defining data
— play rates, win rates, matchup differentials — which Riot's policy prohibits,
and it is the clause most likely to matter when applying for a key. Legends are
grouped by DOMAIN PAIRING instead: descriptive, read straight off the card face,
organised without ranking. `groupByDomains` orders by group size then
alphabetically, and a test asserts that ordering stays explainable.

**Look, choose, commit — three separate acts.** Hover PREVIEWS (the card shows
large in the focus slot, nothing is marked). Pinch SELECTS (the card is marked
everywhere, still nothing in the deck) and pinching the same card again
DESELECTS it, so a mis-pick is undone with the gesture that made it. **Next**
COMMITS and moves the build on. Selecting on hover meant committing to whatever you happened to look at
last, which makes comparing two cards impossible; committing on the pinch made
every stray tap a deck edit. Multi-pick stages — battlefields, runes, the main
deck — stay put and keep counting; the gated ones advance on their own.

Committing carries the build forward on its own. Reaching a new stage reloads
BOTH walls and re-asks the agent for that stage — pick a legend and its
champions appear, pick a champion and battlefields appear. Two bugs made this
worse than it looked: `afterDeckChange` re-rendered only the deck wall, so the
collection wall kept offering legends after one was chosen; and clearing
suggestions without re-asking left the panel blank until the user pressed
"Suggest" again, turning a flow into a chore.

**Hover and selection must be visible.** A gaze-driven interface without
feedback is guesswork — you cannot tell what you are targeting, so you cannot
tell whether a tap will do what you meant. Two states, kept deliberately apart:
HOVERED is transient and follows your gaze; SELECTED is persistent and survives
looking away, because you have to look away from a card to read it in the focus
slot. Both animate rather than snapping: a step change reads as a glitch.

**You can always ask for different cards.** The agent offers a handful, not a
verdict. "Show me others" turns down everything currently on screen and re-asks
excluding it, so the same suggestions never come back; asking a fresh question
clears the turned-down list. Without that, a user who dislikes all three picks
has nowhere to go.

**Show cards, do not describe them.** The agent panel first listed each
suggestion as two lines of reasoning — fine on a monitor, a wall of text at
arm's length. Reading is the most expensive thing you can ask of someone wearing
a headset. It now shows four card faces with name and energy, and the reasoning
for exactly ONE card: the one being looked at. Everything else stays silent
until attended to.

**The display is ADDITIVE.** Specs adds light and can never subtract it, so a
dark panel darkens nothing — it reads as grey haze over the room. UI has to be
bright to exist at all; dark-on-light designs that look right on a monitor are
close to invisible on the device.

**Known constraint:** one `Interactable` plus one collider per tile does not
scale. At 200 tiles the preview stopped responding to input entirely — not
slow, unresponsive. The grid is 12x6 partly for that reason. A full page needs a
different interaction model (one wall-level collider with positional
hit-testing, or interactables pooled around the gaze point).

## Interaction

Gaze targets, voice acts, hands do almost nothing.

| Intent | Utterances | Needs gaze |
|---|---|---|
| `ASK` | "build me a Fury aggro deck", "what goes with this?" | no |
| `SEARCH` | "show me units under four", "only Calm" | no |
| `ADD` / `REMOVE` | "add", "add three", "take one out" | yes |
| `SCAN` | "scan", or automatic on a held card | no |
| `PICK` | "the second one" | no |
| `CLEAR` | "show everything" | no |
| `EXPORT` | "export", "save the list" | no |

Hands: pinch-drag repositions a wall. No card dragging.

**Debug fallback, non-negotiable.** Every intent fires from a tap panel with
identical payloads, and `SCAN` accepts a canned image. Voice and camera both fail
on demo day; the recorded video must run without either. Implemented —
`Core/Intents.ts` is the single dispatch surface.

## Export

1. **Decklist** — plain text, counts per line, legend and runes separated. Must
   round-trip to an identical `Deck`.
2. **Pull list** — the same cards by set and ascending collector number, which is
   the order you flip through a sorted box. This is the bridge back to the
   physical cards.

## Build order

Status as of 2026-09-01. "Verified" means observed running in Preview, not
merely compiling.

- **Phase 0 — done, verified.** Catalogue (1451 cards, real art), collection
  wall, focus slot, tap debug panel, intent surface, attribution.
- **Phase 1 — done, verified.** Local structured filter; deck wall in energy
  columns; `ADD`/`REMOVE` routed to the deck by card type.
- **Phase 2 — done, verified.** RSG + Gemini, local candidate retrieval,
  hallucination guard. Observed returning 5 grounded picks with real card
  reasoning and zero rejected ids.
- **Phase 3 — built, NOT verifiable here.** ASR does not run in Lens Studio
  Preview at all. `Core/Utterance.ts` (transcript to intent) is pure and tested;
  `Runtime/VoiceInput.ts` is written to the canonical ASR pattern but has never
  produced a transcript. **Assume it is unproven until it runs on a device.**
- **Phase 4 — done for the canned path, verified.** Gemini vision read a real
  card as `name=Bewitching Spirit number=121 set=UNL` and the local matcher
  bound it to `unl-121-219`. The live-camera branch is written but is
  device-only and unproven. Quad detection is **not** implemented — the current
  scan sends the whole frame.
- **Phase 5 — detector built and verified on a real card photo; UI not built.**
  `Core/QuadDetect.ts` (Otsu + gradient/texture masks, connected components,
  area/aspect/fill rejection), `Core/QuadTracking.ts` (stable ids across
  frames) and `Core/Trackers.ts` (identity binding, expiry, re-identification)
  are all pure and tested. Verified end to end in Preview against a real card
  composited onto a background: expected box `23,11 19x27`, found
  `23,12 19x25`, aspect 0.76, tracker `q1`. `Runtime/FrameGrabber.ts` reads and
  downsamples camera pixels and can crop a detection for vision.
  `Core/Projection.ts` solves the 2D->3D step: a Riftbound card is a known
  63x88 mm, so its apparent height in pixels gives its distance by similar
  triangles — no depth sensor, no stereo, no ML. Tested including a round trip
  (place a card at 60 cm, compute its pixel height, recover 60 cm).

  `Runtime/CardMarkerView.ts` places a world-space marker per tracker at the
  projected distance, lerped and held through dropped frames, billboarded at the
  viewer (a detection carries no orientation, so feigning the card's tilt would
  be a lie). Verified in Preview: markers appear at plausible distances (38-40 cm
  for a card filling a third of the frame).

  `Config.detection.useCamera` switches the input from the synthetic frame to
  `CameraModule`. **That branch is written but unproven** — Preview has no camera
  feed, so it can only be exercised on a device.

  **The honest state:** with `useCamera: false` the detector runs on a SYNTHETIC
  frame, so markers float in front of the camera rather than sitting on real
  objects. Everything downstream of the pixels — detection, association,
  tracking, projection, world placement, rendering — is verified. Only the pixel
  source is not.

  **Measured limits** (four real cards moving in the test bed, 96x72 detection
  grid): an upright, roughly fronto-parallel card is detected essentially every
  frame at `aspect 0.75, fill 0.99`, and its tracker id stays stable while it
  moves. In-plane rotation is lost past roughly **25-30 degrees** — a turned
  card's axis-aligned bounding box goes square (`aspect 0.88-0.96`) and its
  row-span solidity collapses (`fill 0.53-0.61`).

  Consequences worth knowing before relying on it:
  * **Card held up facing you: works.**
  * **Card lying flat on a table, viewed obliquely: does not.** Perspective
    turns the card into a trapezoid, so a bounding box no longer matches its
    aspect. Supporting that needs corner-based quad fitting (locate four
    corners, correct the perspective) rather than a bounding box, which is a
    different and larger piece of work.
  * **Cards touching or overlapping merge into one blob.** Morphological
    closing bridges gaps narrower than about twice its iteration count, so
    neighbouring cards weld together and the merged box fails on aspect. Keep
    `closeIterations` low; it is not a free knob.

  The detector's key finding: brightness thresholding does NOT work on cards.
  Card art has both dark and light regions, so luma thresholding shatters a card
  into fragments. What separates card from table is DETAIL versus FLATNESS —
  hence the gradient/close mask, which is what actually made the real photo
  work.
- **Phase 6 — done, verified.** `validate()` against `Rules.ts` (every numeric
  rule a placeholder, emitted as an unverified warning), decklist round-trip,
  and the pull list in box order.

Remaining before this is a demo: the interactable scaling problem (below), a
quad detector for Phase 5, and device testing for voice and live camera.

## Tests

Pure functions, runnable without Lens Studio: `node tests/run.mjs`, no npm
dependencies. Covered today: name search including OCR noise and genuine
non-matches, collector-number precedence over a conflicting name, sub-threshold
scans producing alternatives and never auto-adding, duplicate scans incrementing
counts, tile overlap and wall bounds, paging stability as the collection grows,
domain palette separation and order-independence, Riftcodex mapping including
variant markers and rules/flavour separation, art URL construction and clamping.

Still to cover: filter predicates, deck operations, `validate()` per rule in
`Rules.ts`, decklist round-trip, and Gemini response parsing surviving fenced
JSON, trailing prose and truncation.

## Backlog

Wanted, not built. Recorded so they are decisions rather than omissions.

- **Ask Gemini about the card you are pointing at.** `CardScanner` already does
  frame -> Gemini vision -> local match, which answers *which* card. This is the
  next question: *what about it* — what it does, whether it fits the deck, what
  it pairs with. The Depth Cache pattern (a colour+depth snapshot kept for AI
  grounding, see the Specs depth module) is the right shape: capture once, let
  several questions be asked against the same snapshot rather than re-reading
  the card each time. Identity still resolves LOCALLY against the catalogue —
  the model reads and reasons, it never decides which card it is looking at.
- **Card prices from a real source.** A Price button now exists and asks the
  model, at the user's direction. That is RECALL, not a lookup, so the answer is
  shown as a labelled range with a confidence and the words "Not a quote" — see
  Core/CardQuery.ts. Wiring TCGplayer or Cardmarket would turn the estimate into
  a price; until then the framing is doing the work.
- **Sample hand / draw testing.** Check first whether drawing a hand counts as
  simulating gameplay under Riot's policy — it may not be buildable at all.
- **Floating VFX.** Ambient particles around the panels — the rift the logo
  promises, drifting shards — so the space reads as a place rather than a
  set of windows. VFX Graph (`.graphVfx`), kept sparse: on an additive display
  every particle is light the room has to compete with.
- **Scan VFX.** The shutter moment wants a flash and a settle: a bright pulse
  from the capture frame, the detection box drawing itself on rather than
  appearing, and the identified card lifting off the picture. The sound is
  already there; the picture should match it.
- **Scan from the main menu.** A hotbar on the menu with Scan card on it, so a
  card can be read without first choosing a screen to be on — "what is this?"
  is a question people ask before they know whether they are building a deck
  or filing a collection.

## Two people, one deck

Built on SpectaclesSyncKit. Start it from **Play together** on the main menu.

**What is shared is the deck, and only the deck.** Not your scroll position,
not what you have focused, not what you asked the assistant — BINDER.md wanted
the deck argued over, not the cursor fought over.

**The deck is state; an edit is a signal.** One person owns the store and writes
the whole deck to a StorageProperty, which replays to whoever joins late — they
open their eyes and the deck is there. Somebody who does not own the store
cannot write to it (SyncKit drops the write in silence), so their edit travels
as a small message to the owner, who applies it and republishes. That is the
Scoreboard pattern: one writer, everybody else asks.

**An intent from a peer is untrusted input.** It is dispatched into the same
reducer as a local button press, so `Core/DeckWire.ts` holds a whitelist of what
may cross: card edits, nothing else. `ASK` and `PRICE_CARD` spend Gemini quota,
`SCAN` opens your camera, `EXPORT` writes your storage, `FOCUS`/`SCROLL` move
your eyes. The check runs on DECODE as well as encode — the encode side is ours,
the decode side faces somebody else's bytes.

**No SyncKit start menu.** `startMode` is `OFF` and Binder calls
`startMultiplayer()` itself, so opening Binder alone is exactly as it was: no
chooser in front of the app, nothing connects until somebody asks. The bundled
`Examples` object is disabled.

**Verified**: session creates, connects, colocates, claims ownership, and edits
route through the shared path — single Preview pane.
**NOT verified**: two people actually seeing each other's edits. That needs a
second Preview pane (Window → General → Preview) or two devices, which cannot
be driven from here. Until someone runs it, treat the peer path as written but
untested.

## Non-goals

Gameplay of any kind — permanent. Trained card-recognition models. Hand-dragged
layout. More than one deck open at a time.

Deferred, not forbidden: prices, metagame stats, per-frame card re-identification
by perceptual hash (an embedding index, not a classifier — viable, but the
generic tracker made it unnecessary for now).

## Direction change — 2026-09-01

What moved, and why:

- **Added:** conversational agent, search, and the spatial deckbuilder as the
  centre of the experience, to fit the theme.
- **Dropped:** the world-anchored scan gate as the *only* identification path,
  and "continuous card tracking" as a non-goal. A generic unique tracker plus
  one-shot Gemini identification makes card-anchored UI tractable without
  solving re-identification.
- **Kept:** every IP constraint, the `CardSource` seam, the grounding rule, the
  debug-panel fallback, and Config discipline.
