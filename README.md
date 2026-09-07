# Binder

A spatial collection scanner and deckbuilder for Snap Specs. Read your physical
Riftbound cards through the glasses' camera, build a collection wall from what
you actually own, build a deck against it by voice, and get back a decklist plus
a **pull list** — the same cards in set and collector-number order, which is the
order you flip through a sorted box.

The full project contract is in [BINDER.md](BINDER.md).

## Status

Runs in Lens Studio Preview against the real 1451-card catalogue.

| | |
|---|---|
| Collection wall, focus slot, card art | verified in Preview |
| Local search + deck wall (energy columns) | verified in Preview |
| Grounded Gemini agent (suggestions) | verified in Preview — holds the centre of the layout |
| Deck status panel (counts, energy curve, validation) | verified in Preview |
| Card identification from an image (Gemini vision) | verified in Preview, canned image |
| Deck validation + decklist/pull-list export | verified, unit tested |
| Voice (ASR) | **built, unproven** — ASR does not run in Preview at all |
| Live camera scanning | **built, unproven** — device only |
| Quad detection + tracker ids | verified in Preview on a real card photo |
| 2D->3D projection (size-based depth) | verified by unit test, incl. round trip |
| World-space card markers | rendering + projection verified in Preview, driven by the synthetic frame |
| Live camera input | **built, unproven** — `Config.detection.useCamera`, device only |

`Config.dev` holds startup probes (`askOnStart`, `scanOnStart`,
`focusFirstCardOnStart`) used because Preview hand input becomes unreliable as
the interactable count grows. Turn them off before shipping.

**Known issue:** one `Interactable` plus one collider per tile does not scale. At
200 tiles the Preview stopped responding to input entirely. The dev collection
seed is capped at 60 as a workaround; a real fix needs wall-level hit-testing.

## Legal

RiftBinder was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.

Binder is an unofficial fan project. It does not simulate or replicate Riftbound
gameplay: there is no automated rules enforcement, no turn or life tracking, and
no play simulation. It is a card library and deckbuilder, which Riot's Riftbound
Digital Tools Policy lists as approved use cases.

## Card data

Riot has published **no official Riftbound card API**. Access to Riftbound assets
requires an App-specific key approved through the
[Riot Developer Portal](https://developer.riotgames.com/); a generic development
key returns 403 on every Riftbound path.

Until such a key is approved, the catalogue is sourced from
[Riftcodex](https://riftcodex.com), a community index not affiliated with Riot
Games. `Assets/Scripts/Binder/Data/CatalogueGenerated.ts` is a regenerable
snapshot of 1451 cards:

```sh
node tools/fetch-cards.mjs
```

Card art is **not** redistributed — only URLs are stored, and images are fetched
on demand from Riot's own CDN (`cmsassets.rgpub.io`), sized via the CDN's
transform parameters (the full PNG is ~1.4 MB; `?w=160&fm=webp` is ~10 KB).

This is a knowing, documented departure from Riot's "Riot API only" clause, taken
to unblock development. See BINDER.md for the conditions attached to it — in
particular, it must be resolved before applying for a Riot API key.

All card reads go through the `CardSource` interface, so swapping to a
`RiotCardSource` is a new mapper plus a re-run of the generator.

## Development

```sh
node tests/run.mjs      # pure logic tests: matching, layout, collection, palette
```

No npm dependencies. Layout, matching and validation are pure functions that run
outside the Lens Studio runtime; `tests/build.mjs` copies them into `tests/.build/`
with import extensions rewritten for Node's TypeScript stripping.

Secrets live in `secrets/` and are gitignored. Never commit an API key, and never
place one under `Assets/` — that directory ships inside the Lens.
