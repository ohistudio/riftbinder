# RiftBinder — submission

## Public project repo

**https://github.com/ohistudio/riftbinder**

Runs in Lens Studio 5.23 Preview against the real 1,451-card Riftbound
catalogue. Open `DeckBuilder.esproj`, then **Window → Remote Service Gateway
Token → Generate** — the tokens are deliberately not in the repository — and
press play. Two LEAF scenarios are registered (`scan-rengar`, `deck-building`)
and run from the LEAF panel.

## Demo video

**https://github.com/ohistudio/riftbinder/releases/download/v1.0/RiftBinder-demo.mp4**

Direct download, public, no account needed (~75 MB, MP4). Also on the
[v1.0 release page](https://github.com/ohistudio/riftbinder/releases/tag/v1.0).
Voiceover script in [`docs/VOICEOVER.md`](docs/VOICEOVER.md).

## CLAD prompt log

Two files:

- **[`docs/CLAD-PROMPT-LOG-RAW.txt`](docs/CLAD-PROMPT-LOG-RAW.txt)** — the raw
  log: all 98 prompts typed to the agent, verbatim and timestamped, extracted
  from the session transcript. Nothing corrected or grouped.
- [`docs/CLAD-PROMPTS.md`](docs/CLAD-PROMPTS.md) — the same prompts curated:
  spelling fixed, grouped by what was being worked on, each group traced to
  the code it produced.

The whole project was built this way: no line of it was typed into an editor
by hand. The prompts are mostly observations rather than instructions — "buttons
are hard to see", "where's the side deck?", "the card is too high up" — and the
log records which of those turned out to have a cause somewhere other than the
obvious place, which was most of them.

## Project description

**What it is.** RiftBinder is a spatial deckbuilder for the Riftbound trading
card game, built for Snap Specs. You hold a physical card up to the glasses;
Gemini reads what is printed on it; the catalogue — not the model — decides
which card it is. The card lands in a collection wall you can scroll by pinch,
or straight into the deck you are building, laid out on a sheet formatted like
a decklist with main deck, runes and sideboard. An assistant panel answers
questions about a card, suggests picks grounded in a shortlist chosen locally
(it can only name cards it was handed), and gives a price estimate that says
"estimate" on its face. The deck validates itself against the game's
construction rules as you go, and turns legal with a chime. Two people in the
same room can build one deck together over SpectaclesSyncKit.

**How it responds to the theme — Week 4: Create.** A deck is a thing you make,
and today making one means a browser tab, a spreadsheet, and a box of cards on
the desk beside them, looking up each one by hand. RiftBinder puts the making
where the cards already are: hold one up and it is read, in front of you;
your deck is a sheet on the wall that fills as you go and tells you the moment
it becomes legal; the assistant sits to one side and answers "what does this
do" and "does it fit" without you leaving the table; and a friend in the same
room can build the same deck with you. Faster because identification is a
glance rather than a search, easier because the rules check themselves, and
more intuitive because the deck is laid out the way people already lay decks
out — on a table, in front of them, in sections.

**Who it is for.** People who play Riftbound and own physical cards: the
collector sorting a box, the player at a kitchen table with a friend arguing
over forty slots, the person at a shop who wants to know what the card in their
hand does before they buy it. It is unofficial and says so — Riot Games does
not endorse or sponsor it, and the required notice is on the main menu.

**How CLAD was used.** Everything: scene construction, the UIKit interface,
the MeshBuilder rims on every panel, the Gemini vision and text integrations
through Remote Service Gateway, the SyncKit session, the LEAF scenarios that
drive a simulated hand through scanning a card and building a deck, and the
sound effects. The agent verified its own work in Preview — running LEAF,
reading logs, taking screenshots — and the log is honest about which fixes
came from a screenshot showing something the code did not.

---

## Recording the demo

The `deck-building` LEAF scenario is the demo: it opens the deck screen,
chooses a legend, its champion and three battlefields from the wall, picks up a
Rengar card, holds it to the camera, scans it, asks the assistant about it,
prices it, adds it to the deck, picks a dozen more cards, then turns to the
deck sheet. ~90 seconds.

1. In `Assets/Scripts/Binder/Core/Config.ts`, `Config.dev.layoutScale` is set
   to `1.45` so the whole layout fits the Preview frame. Leave it there for
   the recording; set it back to `1` for wearing.
2. Reset the Preview camera before starting — the layout is placed relative to
   the camera at lens start.
3. Start Preview recording, then run `deck-building` from the LEAF panel.
4. Upload to Drive / Dropbox / WeTransfer and put the link above.

`scan-rengar` is a shorter alternative (~20 s): one card, held up, scanned,
identified, with Ask pressed at the end.
