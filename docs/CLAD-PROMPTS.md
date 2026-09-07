# RiftBinder — the prompts that built it

Every instruction given to the agent in this session, in order, lightly
corrected for spelling so they can be reused verbatim. Kept because the prompts
are the record of *why* the app looks the way it does: almost every design
decision here started as one line of feedback, usually after looking at a
screenshot and finding something wrong.

Grouped by what was being worked on. The note under each group says what it
produced, so a prompt can be traced to the code it caused.

---

## 1. Interaction — scrolling and panels

```
can you not test this with clad
no i do not want buttons for scrolling, i want pinch with SIK
think zoom the cards in so 5 across, we don't need remove-last, let's have AI as
  another side panel and the deck you're making as another one, don't need recentre
seems the other panels are rotated the wrong way
the scroll is a bit sensitive, make the panels moveable and position them all correctly
let's also billboard panels
```

Drag-to-scroll on `Interactable`; three silent SIK bugs found (`planecastPoint`
frozen during drag, `onTriggerEndOutside` never subscribed, pinch jitter
misreading taps as drags). Panels became movable via grab bars, and
`wallPlacement` learned to negate its yaw — a panel's front is local +Z, so
rotating by its own bearing turned it away from the wearer.

## 2. Deck building and the assistant

```
I think always auto-do runes, keep ask button, keep sort button, add a search
  button with a keyboard, and also add a camera button — this takes a pic, use
  Gemini to understand the card and add to deck
do a run through with the UI panels, make them look better; let me also be able
  to move the zoomed-in preview card
add to a to-do list: multi-view, 2 players can join the same session, and I want
  to add card prices
I want it to have a main menu, so it doesn't go straight into deck building —
  build deck, your cards, and the last menu item will be store finder
```

## 3. Scanning a card

```
I also want the pic to show a Gemini overlay of what it's got
I'm not sure the scan card is working — I put in an image of Rengar and it doesn't scan it
you're using clad right?
[scan] read name=null number=null set=null — I can't see it send an image; return
  an image with a label showing where it identified the card and what card it is
it seems to not be sending my camera frame — for preview I have made fake images
  of cards in the scene, I want it to see the fake render not just the real world
it seems to not show me what image it sends to Gemini; the image seems cut off,
  like it's clipping close to camera
[scan] read name=Rengar number=UNL 120 set=null — why's it say null? we are adding
  it to our card collection, it got it right
no Gemini overlay that I can see, but it got the card — I want some UI like add to deck?
still no Gemini overlay on the image returned
seems the scan card isn't sending the environment
the card is too high up in the view
I don't want to see the JSON on "what the camera sent" — let's just call this
  "Your scan": we see the image, the highlighted card, and the card it found.
  Add an ask button so we can ask the AI about this card
does the scanned card show the price?
if we are on build deck and we scan, it should say Choose not Add
the green Gemini box wasn't shown on the found card either
```

The long one. A canned image silently winning every scan, an unwired
`cameraModule`, a cold camera texture, Binder's own UI photographing itself, a
set code swallowed by the collector number, and finally the discovery that a
render-target camera composites no background at all — hence the backdrop that
puts the room behind the Lens content.

## 4. LEAF — rehearsing the scan

```
out of interest, can we use LEAF to spawn a hand and put one of those Rengar
  cards in it, so in preview when we press scan card we do a LEAF animation
open up the project
how do I run LEAF?
run it / run it again
I kind of wanted the hand to pick up RengarCard in the scene hierarchy
I want the camera position a bit further back
it picks the Rengar card up too close
can you show me the LEAF scenario for scan card again — we want a hand to hold
  the card up, scan the card etc
when we do the scan can we move the camera to look at the card scan window
let's start one scenario called deck building: I have two Rengar cards,
  RengarCardMain and RengarCard — scan main, select choose, go to next step, then
  scan RengarCard and add it to deck, then select cards from the menu until complete
```

## 5. The look

```
do a run on the UI, use UI Kit — I don't like the current theme. Add a nice
  gradient and also a border using MeshBuilder
buttons are hard to see
I'd like the button fill to have a colour too
make sure all bottom panels fit the main panel — see "your decks" for example
can you make this text more visible, it's quite small in the scanned card panel
text clips the bottom buttons on the scanned card
same with assistant — the text is small, hard to read, and overlaps buttons
some of the text on assistant overlaps too
the bottom panel that says "no problems found" overlaps with the
  "ask about this deck" button
make me a logo for this too please
```

Nearly all of these were things a screenshot showed and the code did not: an
invisible-but-valid mesh (back-face culled), a rim buried inside the plate, a
`baseColor` the shader ignores because the style paints a gradient, and four
successive text collisions in the assistant panel, each uncovered by fixing the
last.

## 6. Where things live

```
stop moving the menu if I move
I told you to not move the menu if I move
seems we have two panels building the deck — I like the one with the formatting
  I asked for, the deck sheet
position the new deck panel closer
position the deck sheet similar to the other panels; it's close and to the right
  of the player right now
for the deck sheet we can make them bigger, we have a lot of free space
where's the side deck? you've also clipped the card titles
also why does the whole experience move, not just the camera?
```

The menu was not billboarding — an auto-recenter was re-placing every panel in
front of the wearer whenever the layout drifted. Now off.

## 7. Voice, hints, content

```
ask needs to pick up mic input
ask is also mic input, not keyboard
why is our AI getting an error? doesn't seem to work at all now
[PRICE_CARD] no price? and the ask button doesn't seem to do anything?
can you also build me a few decks so "my decks" is populated
let's also call this RiftBinder
while loading, can we add loading hints [list supplied]
```

The assistant was never broken: `gemini-2.5-flash` thinks by default and the
prompt carried forty full card texts, so the call sat on the gateway's 30-second
deadline and failed about half the time with an empty body. Thinking off,
candidates cut to eighteen: ~6 seconds.

## 8. Working through the backlog

```
next        -> the 3-signature-card limit (103.2.d)
next        -> two people in one session, via SpectaclesSyncKit
next        -> the missing Riot attribution
do it
```

---

## What the prompts have in common

Worth noting for anyone reusing these: the ones that moved the project fastest
were **observations, not instructions** — "buttons are hard to see", "the card
is too high up", "where's the side deck?". Each named a symptom and left the
diagnosis open, and in almost every case the cause was somewhere other than the
obvious place. The prompts that asked for a specific fix were usually right
about the goal and wrong about the mechanism.

The other recurring instruction is the first one in this list, and it is the one
that mattered most: **test it with CLAD before saying it works.**
