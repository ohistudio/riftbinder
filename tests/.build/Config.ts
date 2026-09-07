// Binder — every tunable number in one place, because all of them change
// once it is on a face. Distances are CENTIMETRES (BINDER.md § Platform).
//
// Lens Studio world units are already centimetres, so the boundary conversion
// is identity today. It is still routed through cmToWorld() so a future unit
// change is one edit rather than a grep.

export const CM_TO_WORLD = 1;
export function cmToWorld(cm: number): number { return cm * CM_TO_WORLD; }
export function worldToCm(world: number): number { return world / CM_TO_WORLD; }

export interface WallConfig {
  /** Wall face size in cm. */
  widthCm: number;
  heightCm: number;
  /** Distance from the user's anchor point, in cm. */
  distanceCm: number;
  /** Yaw about the user, degrees. Negative is left. */
  yawDeg: number;
}

export const Config = {
  /**
   * The panel furniture, in one place so the three surfaces relate to each
   * other instead of drifting apart.
   *
   * Additive display: Specs ADD light and never subtract it, so these are all
   * dim. The backing is the darkest thing that still reads as a surface —
   * anything brighter competes with the card art it exists to hold.
   */
  ui: {
    /**
     * Panel backing. Still the darkest surface, but lifted and warmed: on an
     * additive display the old value was so close to black that the panel read
     * as a hole rather than a surface, which is most of what made the interface
     * look flat.
     */
    panel: { r: 0.13, g: 0.12, b: 0.27 },
    /**
     * Buttons, a clear step up from the panel so they read as pressable. Warmer
     * than the panel as well as lighter — a button that differs only in
     * brightness reads as the same surface under a highlight.
     */
    // Saturated on purpose. An additive display ADDS light, so a mid-tone with
    // near-equal channels washes out to grey — the hue only survives if red and
    // green are held well below blue.
    button: { r: 0.17, g: 0.13, b: 0.50 },
    /** The grab bar, brighter again so it reads as the thing you take hold of. */
    handle: { r: 0.46, g: 0.44, b: 0.78 },
    /**
     * The one saturated colour, for the row you are being pointed at. Kept to a
     * single accent so it still means something when it appears.
     */
    accent: { r: 0.38, g: 0.82, b: 1.00 },
  },

  layout: {
    // NOTE these are smaller and closer than BINDER.md originally specified.
    //
    // The Specs camera is ~36 degrees vertical: at 250 cm you can see about
    // 165 cm across, so a 240 cm wall overflows the view and you can never see
    // the grid as a whole. The original numbers assumed a much wider FOV. These
    // are sized so a wall fits in one glance, with the walls flanking the
    // working area rather than surrounding it.
    collectionWall: {
      widthCm: 84,
      // Taller than the grid: the heading sits above it and the control grid
      // below, and both live on this panel. 78, not 74 — at 74 the second row
      // of controls hung 1.2 cm off the bottom edge of its own panel.
      heightCm: 78,
      distanceCm: 150,
      // Dead ahead. The collection is the thing you work in, so it takes the
      // centre and the two panels that serve it flank at a head-turn.
      yawDeg: 0,
    } as WallConfig,

    /**
     * The deck sheet: wide, because a decklist is read across rather than down.
     * Behind you and to the right by default — it is a reference you turn to,
     * not something to build in front of.
     */
    deckSheet: {
      widthCm: 116,
      heightCm: 96,
      // Where the deck WALL used to be, because it is what replaced it: the
      // same head-turn to the right as the assistant is to the left, at the
      // same distance as every other wall. At 78 degrees and 120 cm it sat off
      // to the side, closer than everything else and facing its own direction.
      distanceCm: 150,
      yawDeg: 42,
    } as WallConfig,

    /** The agent: a side panel of its own, mirroring the deck. */
    agentWall: {
      widthCm: 56,
      // 50. Each stacking fix uncovered the next collision: at 36 the reason
      // line met the buttons; at 44 it cleared them but ran into the card
      // slots' OWN name labels, which sit at -7.0 to -9.6 under each card. The
      // panel is now tall enough for four bands that do not touch — status,
      // cards with their labels, the answer, then the buttons.
      heightCm: 50,
      distanceCm: 150,
      yawDeg: -42,          // a comfortable head-turn to the left
    } as WallConfig,

    deckWall: {
      widthCm: 84,
      heightCm: 60,
      distanceCm: 150,
      yawDeg: 42,           // mirrored to the right
    } as WallConfig,

    /**
     * Card aspect 0.72. Big enough to recognise the art at 150 cm without
     * having to focus the card first — browsing is looking, not reading.
     */
    tile: { widthCm: 12.4, heightCm: 17.2, gutterCm: 2.2 },

    /**
     * The deck wall is a SUMMARY — the curve at a glance — so it keeps the
     * small tile. Scaling it up with the browse tile made the energy columns
     * overlap, because that layout squeezes the step but never the tile.
     */
    deckTile: { widthCm: 7.2, heightCm: 10, gutterCm: 2 },

    /**
     * 5 x 3 = 15 tiles visible, SCROLLED rather than paged.
     *
     * Small on purpose. One Interactable plus one collider per tile stopped the
     * preview responding to input at 200, and was unreliable well below that.
     * Scrolling means the visible count no longer has to grow with the pool —
     * 180 legends scroll through 15 slots instead of needing 180 colliders.
     */
    grid: { cols: 5, rows: 3 },

    /**
     * The control grid that sits below the cards, ON the browse panel.
     * Here rather than in the view so a test can check the whole stack —
     * heading, grid and controls — still fits the panel it is drawn on.
     */
    controls: { columns: 5, rowHeightCm: 3.4, gapCm: 0.6, topOffsetCm: 4.5 },

    /** Focus slot: one card, big enough to read official text. */
    focus: { heightCm: 26, distanceCm: 105 },

    /**
     * Resolution of the frame sent to the model, px.
     *
     * A card lying on a table across the room is a small part of the picture,
     * and its rules text is smaller still — at 720 wide the model read the art
     * and invented a name. More pixels is the cheapest way to make the print
     * legible before falling back to cropping.
     */
    scanCapture: { widthPx: 1440, heightPx: 1632 },

    /** Scan gate: the user holds a physical card into this frame. */
    scanGate: { widthCm: 14, heightCm: 20, distanceCm: 45 },

    /**
     * The walls are world-anchored so you can walk around them — but if you
     * wander off or turn away entirely, a world-anchored layout is simply gone
     * with no way back. These thresholds bring it to you when it is out of
     * play, and never while you are looking at it.
     */
    recenter: {
      /**
       * Follow the wearer automatically. OFF.
       *
       * This used to re-place every panel in front of you whenever the layout
       * drifted far enough away or fell behind you — which, from the inside,
       * is the menu getting up and moving every time you do. Panels are world
       * anchored and every one has a grab bar, so moving them is a thing you
       * ask for. The Recentre intent still does it on demand.
       */
      automatic: false,
      /** Recentre if the layout is further away than this. */
      maxDistanceCm: 500,
      /** Recentre if it is behind you: cos(angle) below this counts as behind. */
      minFacingDot: -0.1,
      /** How often to check. Cheap, but no reason to do it every frame. */
      checkIntervalMs: 500,
    },
  },

  matching: {
    /** Normalised-similarity score at or above which a scan auto-accepts. */
    autoAcceptThreshold: 0.82,
    /** How many candidates to surface when below threshold. */
    maxAlternatives: 3,
    /** Candidates scoring below this are not worth showing at all. */
    minAlternativeScore: 0.35,
  },

  detection: {
    /**
     * Detection runs on a downsampled frame.
     *
     * 96x72, not 64x48. The morphological close needs the card to be comfortably
     * bigger than its kernel: at 64x48 a card filling a third of the frame is
     * only ~11x16 px, and three dilate/erode passes consume it, so detection
     * collapsed to one card in four. 96x72 puts the same card at ~17x24 and it
     * holds. Still only ~7k pixels, so the cost is negligible.
     */
    widthPx: 96,
    heightPx: 72,
    /** Detection pass interval. A held card does not need re-finding at 60 Hz. */
    intervalMs: 200,
    /** How long a tracker must be stable before it earns a vision call. */
    identifyAfterMs: 600,
    /** Drop a tracker unseen for this long, discarding its identity binding. */
    trackerTtlMs: 1200,

    /**
     * Place markers in the world using the size-based depth solve.
     *
     * When `useCamera` is false the detector runs on the synthetic test frame
     * and that frame is treated AS IF it were the camera view — which verifies
     * projection, the world transform and marker rendering, leaving only the
     * live pixel feed unproven. Set true on a device to use the real camera.
     */
    worldMarkers: false,
    useCamera: false,
  },

  scanning: {
    /** Frame-to-frame difference must stay under threshold for this long. */
    stillHoldMs: 400,
    /** Mean per-pixel difference (0..1) counted as "still". */
    stillDiffThreshold: 0.02,
  },

  dev: {
    /**
     * Phase 0 scaffolding: the collection wall is meant to show what you OWN,
     * which Phase 1 fills in from real scans. Until then it is seeded from the
     * catalogue so there is something to look at. Bounded deliberately — a full
     * 200-tile page means 200 colliders and 200 Interactables, which makes the
     * preview too slow to respond to input at all.
     */
    seedCollectionFromCatalogue: 60,

    /**
     * Put a card in the focus slot at startup. Without it the slot sits empty
     * until something is gazed, which also makes the art path untestable
     * without driving input.
     */
    focusFirstCardOnStart: false,

    /**
     * Fire one ASK at startup. Dev only: preview input becomes unreliable as
     * the interactable count climbs, and this isolates the agent's network path
     * from whether a pinch landed. Empty string disables it.
     */
    askOnStart: 'help me start an aggressive deck',

    /** Fire one SCAN of the canned image at startup. Dev only, same reason. */
    scanOnStart: false,

    /** Screen to open on: 'menu', 'deck', 'cards' or 'stores'. */
    /**
     * Put a few example decks on the shelf when it is empty.
     *
     * An empty "Your decks" is a poor first look — you cannot tell what a saved
     * deck contains or whether the screen works. Built from the real catalogue,
     * saved once, and thereafter the user's own to keep or delete.
     */
    seedStarterDecks: true,
    /**
     * Push the whole layout back by this factor. 1 for wearing. For RECORDING
     * a preview demo set it to ~1.4: the preview camera's field of view is
     * fixed and the layout follows the camera, so the only way to fit the
     * panels, the hand and the held card in one frame is to place them
     * further away. Nothing else changes — panel sizes, text, distances
     * between panels all scale together.
     */
    layoutScale: 1.45,
    startOnMode: 'menu',

    /**
     * Scan the RENDERED SCENE rather than the raw camera feed.
     *
     * On by default. The passthrough feed contains only the real room, so a
     * card that exists as a Lens object — every card in Preview — is invisible
     * to it. Rendering the scene captures what the wearer actually sees.
     */
    scanRenderedScene: true,

    /**
     * Read the wired canned image INSTEAD of the camera.
     *
     * Off. The canned image exists so a scan still works with a dead camera,
     * but while it silently won every scan the camera was never consulted —
     * you could hold up any card and always get the canned one back.
     */
    useCannedScan: false,

    /**
     * Open the app already at a given stage, by auto-committing the earlier
     * choices. Dev only: preview hand input is unreliable, so reaching a late
     * stage by driving pinches is slow and often fails outright. Empty string
     * starts from the beginning as a user would.
     */
    startAtStage: '',

    /** Open the export panel at startup, to inspect it without driving input. */
    exportOnStart: false,

    /**
     * Run one detection pass over the canned card image at startup. The camera
     * is device-only, so this is the only way to exercise the real CV path
     * (grab -> threshold -> components -> associate) off a device.
     */
    /**
     * Render a live detection demo: the card slides across a synthetic frame,
     * the detector runs each interval, and a box is drawn over what it found.
     * The card MOVING is the point — a static box shows detection, a box that
     * follows while the tracker id holds shows tracking.
     */
    detectionDemo: false,
  },

  sources: {
    /** Both deferred to post-v1. Null implementations ship today. */
    pricesEnabled: false,
    statsEnabled: false,
  },
} as const;

export type BinderConfig = typeof Config;
