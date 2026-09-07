// Binder — Phase 0 entry point. Lens runtime.
//
// Owns the card source, the collection state, and the single intent dispatcher
// that voice (Phase 4) and the tap debug panel both feed. No camera, no AI:
// Phase 0 is data -> wall -> focus -> debug panel, and nothing else.

import { PROJECT_TITLE } from '../Core/Attribution';
import { nextHint } from '../Core/Hints';
import { buildStarterDecks } from '../Core/StarterDecks';
import { Config, cmToWorld, worldToCm } from '../Core/Config';
import { BinderSfx } from './BinderSfx';
import { Juice } from './Juice';
import { freezeTexture } from './SceneCapture';
import { buildCardFactsPrompt } from '../Core/AgentPrompt';
import { wallPlacement, gridSpanCm } from '../Core/Layout';
import { buildDomainPalette } from '../Core/DomainColor';
import type { CollectionState } from '../Core/Collection';
import { emptyCollection, addCard, removeCard, countOf } from '../Core/Collection';
import { DeckSession } from './DeckSession';
import { isShareable } from '../Core/DeckWire';
import { emptyDeck, addToDeck, removeFromDeck, mainDeckSize, runeDeckSize, setChosenChampion, matchesLegendChampion, autoFillRunes, isInDeck, cycleCard, maxCopiesFor, deckCount, toggleSideboard, sideboardSize } from '../Core/DeckOps';
import type { CardFilter } from '../Core/Search';
import { applyFilter, emptyFilter, parseFilter, describeFilter } from '../Core/Search';
import { selectCandidates, buildSuggestionPrompt, parseAgentResponse } from '../Core/AgentPrompt';
import { stageOf, stagePool, browseOrder, RUNES_REQUIRED } from '../Core/Browse';
import type { SortMode } from '../Core/Sort';
import { sortCards, sortLabel, nextSortMode } from '../Core/Sort';
import { validate, errorCount } from '../Core/Validate';
import { exportDecklist, buildPullList, formatPullList } from '../Core/Export';
import { MemoryCardSource } from '../Core/MemoryCardSource';
import { NullPriceSource, NullStatsSource } from '../Core/NullSources';
import { CATALOGUE_CARDS, CATALOGUE_SOURCE, CATALOGUE_FETCHED_AT } from '../Data/CatalogueGenerated';
import type { Card, CardSource, Deck, ScanResult } from '../Core/Types';
import type { DetectionView } from './CardDetector';

interface AnchorPlacement {
  /** Offset in USER space, cm: -Z ahead, +X right, Y relative to eye line. */
  positionCm: { x: number; y: number; z: number };
  yawDeg: number;
}
import type { Intent } from '../Core/Intents';
import { describeIntent } from '../Core/Intents';
import { makeLabel, makePlate, uiColor } from './ViewUtils';
import { CardArtLoader } from './CardArtLoader';
import { CollectionWallView } from './CollectionWallView';
import { DeckWallView } from './DeckWallView';
import { DeckSheetView } from './DeckSheetView';
import { DeckLibraryView } from './DeckLibraryView';
import type { DeckLibrary } from '../Core/DeckLibrary';
import {
  emptyLibrary, parseLibrary, serialiseLibrary, saveDeck as saveIntoLibrary, findDeck,
} from '../Core/DeckLibrary';
import { buildDeckSheet } from '../Core/DeckSheet';
import { buildPricePrompt, parsePriceResponse, describePrice } from '../Core/CardQuery';
import { DeckStatusView } from './DeckStatusView';
import { ExportPanelView } from './ExportPanelView';
import { GeminiAgent } from './GeminiAgent';
import { AgentPanelView } from './AgentPanelView';
import { PanelHandle, makeMovable } from './PanelHandle';
import { makeBillboard, setButtonPressFeedback } from './UIKitUtils';
import { SearchInput } from './SearchInput';
import { MainMenuView } from './MainMenuView';
import { StoreFinderView } from './StoreFinderView';
import { ScanPreviewView } from './ScanPreviewView';
import { SceneCapture } from './SceneCapture';
import type { AppMode } from '../Core/Modes';
import { panelsFor, headingFor } from '../Core/Modes';
import { CardScanner } from './CardScanner';
import { CardDetector } from './CardDetector';
import { describeCandidates } from '../Core/QuadDetect';
import { ProbeSceneBuilder } from './DetectionProbe';
import { DetectionDebugView } from './DetectionDebugView';
import { CardMarkerView, MarkerUpdate } from './CardMarkerView';
import { detectionToCameraPose } from '../Core/Projection';
import { VoiceInput } from './VoiceInput';
import { applyScan, resolveUnmatched } from '../Core/Collection';
import { FocusSlotView } from './FocusSlotView';
import { DebugPanel } from './DebugPanel';

const TAG = '[Binder]';

/** How far below a panel its control block sits, cm. */
const CONTROLS_DROP_CM = 10;
/** The menu and store panels share a size. */
const STORE_PANEL_HEIGHT_CM = 66;
// Five rows, not four: the share row made the panel overflow its own backing
// plate, which reads as a rendering bug rather than a long menu. One row is
// ROW_HEIGHT_CM + ROW_GAP_CM in MainMenuView.
const MENU_PANEL_HEIGHT_CM = 92;
/** Menu, store finder and deck shelf all share this width. */
const SIDE_PANEL_WIDTH_CM = 62;
/**
 * How far below the deck sheet its status sits.
 *
 * Enough to clear the sheet's own "Ask about this deck" button, which sits just
 * inside the bottom edge — at 16 the two overlapped once the sheet grew.
 */
const STATUS_DROP_CM = 26;

@component
export class BinderApp extends BaseScriptComponent {
  @input @hint('1x1 plane mesh — tiles and panels scale it to size')
  tileMesh: RenderMesh;

  @input @hint('Unlit material template — every tile clones it before tinting')
  tileMaterial: Material;

  @input @hint('Unlit material with Base Texture enabled — carries card art')
  artMaterial: Material;

  @input @hint('Font for tile labels, focus text and the debug panel')
  font: Font;

  @input @hint('Fetches card art from Riot\'s CDN on demand')
  internetModule: InternetModule;

  @input @hint('Turns a fetched image into a Texture')
  remoteMediaModule: RemoteMediaModule;

  @input @allowUndefined @hint('Live camera for scanning physical cards (device only)')
  cameraModule: CameraModule;

  @input @allowUndefined @hint('Stand-in card image so SCAN works with no camera')
  cannedScanImage: Texture;

  @input @allowUndefined @hint('Extra card images for the detection test bed')
  testCards: Texture[];

  @input @hint('Vertical offset from the user\'s eye line, cm. 0 is eye level.')
  eyeHeightCm: number = 0;

  @input @allowUndefined @hint('Camera to lay the experience out in front of. Found automatically if unset.')
  camera: Camera;

  private source: CardSource;
  private state: CollectionState = emptyCollection();
  private wall: CollectionWallView;
  private deckWall: DeckWallView;
  private deckSheet: DeckSheetView | null = null;
  private agentPanel: AgentPanelView;
  private readonly searchInput = new SearchInput();
  /** Browse only the cards you own. Off by default: you start with nothing. */
  private ownedOnly = false;
  private mode: AppMode = 'menu';
  private menuView: MainMenuView | null = null;
  private storeView: StoreFinderView | null = null;
  private scanPreview: ScanPreviewView | null = null;
  private scanPreviewRoot: SceneObject | null = null;
  private sceneCapture: SceneCapture | null = null;
  private menuRoot: SceneObject | null = null;
  private storeRoot: SceneObject | null = null;
  private controlsRoot: SceneObject | null = null;
  private focusRoot: SceneObject | null = null;
  private deckStatus: DeckStatusView | null = null;
  private deckStatusRoot: SceneObject | null = null;
  /** So a deck change can tell an addition from a removal. */
  private lastDeckSize = 0;
  /** So the deck turning legal is heard once, not on every later edit. */
  private lastErrorCount = -1;
  private session: DeckSession | null = null;
  /** Which hint was last shown, so the next one is never the same. */
  private lastHint = -1;
  private exportPanel: ExportPanelView | null = null;
  private showingDecklist = false;
  private readonly agent = new GeminiAgent();
  private readonly sfx = new BinderSfx();
  private readonly juice = new Juice();
  private lastScanned: Card | null = null;
  private readonly anchors: { object: SceneObject; placement: AnchorPlacement }[] = [];
  private scanner: CardScanner;
  private detector: CardDetector;
  private detectionView: DetectionDebugView | null = null;
  private markerView: CardMarkerView | null = null;
  private lastDetectionStepAt = 0;
  private lastDetectionLogAt = 0;
  private liveCameraTexture: Texture | null = null;
  private probeScene: ProbeSceneBuilder | null = null;
  private probeGray: Uint8Array | null = null;
  private voice: VoiceInput | null = null;
  private deck: Deck = emptyDeck('deck-1', 'New Deck', 0);
  private filter: CardFilter = emptyFilter();
  private knownDomains: string[] = [];
  private focus: FocusSlotView;
  private debug: DebugPanel;
  /** What gaze is resting on. Transient — drives the focus slot only. */
  private previewedCardId: string | null = null;
  /** Ids currently on the agent panel, so MORE can turn them down. */
  private lastOffered: string[] = [];
  private dismissed: string[] = [];
  private lastPrompt = 'help me start a deck';
  private lastStage: string = '';
  private sortMode: SortMode = 'grouped';
  /** AI guidance on by default; manual building is a button away. */
  private aiGuidance = true;
  /** Where the user was standing when the layout was placed. */
  private originCm = new vec3(0, 0, 0);
  private originYawDeg = 0;
  private wallAnchor: SceneObject | null = null;
  private deckAnchor: SceneObject | null = null;
  private sheetAnchor: SceneObject | null = null;
  private decksAnchor: SceneObject | null = null;
  private deckLibraryView: DeckLibraryView | null = null;
  private library: DeckLibrary = emptyLibrary();
  private agentAnchor: SceneObject | null = null;
  private lastRecenterCheckAt = 0;

  // Deferred by contract; held so the wiring exists before the data does.
  private readonly prices = new NullPriceSource();
  private readonly stats = new NullStatsSource();

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.onStart());
    this.createEvent('UpdateEvent').bind(() => this.onUpdate());
  }

  /**
   * Bring the layout back if the user has walked away from it or turned right
   * around. Only fires when it is genuinely out of play — recentring something
   * the user is looking at would be jarring.
   */
  private onUpdate(): void {
    this.stepDetectionDemo();
    // Every frame, independent of the detection rate: this is what makes the
    // box glide rather than step at 5 Hz.
    const dt = getDeltaTime();
    this.juice.advance(dt);
    this.wall.advance(dt);
    this.deckWall.advance(dt);
    this.agentPanel.advance(dt);
    this.debug.advance(dt);

    if (this.detectionView !== null) this.detectionView.advance(getDeltaTime());
    if (this.markerView !== null) {
      const cam = this.camera ?? this.findCamera();
      if (cam !== null) {
        this.markerView.advance(getDeltaTime(), cam.getSceneObject().getTransform().getWorldRotation());
      }
    }
    // Panels stay where they are put. See Config.layout.recenter.automatic.
    if (!Config.layout.recenter.automatic) return;
    if (this.wallAnchor === null) return;
    const now = getTime() * 1000;
    if (now - this.lastRecenterCheckAt < Config.layout.recenter.checkIntervalMs) return;
    this.lastRecenterCheckAt = now;

    const camera = this.camera ?? this.findCamera();
    if (camera === null) return;
    const transform = camera.getSceneObject().getTransform();
    const eye = transform.getWorldPosition();
    const look = transform.getWorldRotation().multiplyVec3(new vec3(0, 0, -1));

    const toWall = this.wallAnchor.getTransform().getWorldPosition().sub(eye);
    const distance = toWall.length;
    if (distance < 1) return;

    const facing = (look.x * toWall.x + look.y * toWall.y + look.z * toWall.z) / distance;
    if (distance > Config.layout.recenter.maxDistanceCm || facing < Config.layout.recenter.minFacingDot) {
      this.recenter();
    }
  }

  private onStart(): void {
    if (!this.tileMesh || !this.tileMaterial || !this.artMaterial || !this.font) {
      console.error(`${TAG} missing inputs — assign tileMesh, tileMaterial, artMaterial and font`);
      return;
    }
    if (!this.internetModule || !this.remoteMediaModule) {
      console.error(`${TAG} missing inputs — assign internetModule and remoteMediaModule`);
      return;
    }

    this.source = new MemoryCardSource(CATALOGUE_CARDS);
    if (CATALOGUE_CARDS.length === 0) {
      console.warn(`${TAG} catalogue is empty — run: node tools/fetch-cards.mjs`);
    }

    this.buildScene();
    this.seedFromSource();
    const all = this.source.all();
    this.debug.setFirstCard(all.length > 0 ? all[0].id : null);
    this.scanner = new CardScanner(this.source, Config.matching, this.resolveCameraModule());
    // Open the camera now, not on the first press: the texture fills in
    // asynchronously and a cold one cannot be encoded.
    this.scanner.warmUp();

    const eye = this.camera ?? this.findCamera();
    if (Config.dev.scanRenderedScene && eye !== null) {
      this.sceneCapture = new SceneCapture(
        eye, Config.layout.scanCapture.widthPx, Config.layout.scanCapture.heightPx);
      // The room goes behind the Lens content. Without it the capture camera
      // draws geometry over an empty background and the scan is a card
      // floating in a void — no table, no hand, nothing to judge scale by.
      this.sceneCapture.buildBackdrop(this.tileMesh, this.artMaterial);
    }
    this.detector = new CardDetector(Config.detection.widthPx, Config.detection.heightPx);
    this.debug.setAiLabel(this.aiGuidance);
    this.debug.setSortLabel(sortLabel(this.sortMode));
    // Hold the ask button to talk; releasing sends what was heard.
    this.debug.onSearch(() => this.openSearchKeyboard());
    this.debug.onMenu(() => this.setMode('menu'));
    this.debug.onHold(
      () => { if (this.voice !== null) this.voice.start(); },
      () => { if (this.voice !== null) this.voice.stop(); },
    );

    // Every button in the app presses back: a sound and a quick squash. One
    // registration; the button-building sites all route through it.
    setButtonPressFeedback((object) => {
      this.sfx.press();
      this.juice.pulse(object);
    });

    this.voice = new VoiceInput(
      (intent) => this.dispatch(intent),
      () => this.previewedCardId,
      (message) => this.agentPanel.setStatus(message),
    );

    this.renderWalls();
    if (this.deckStatus !== null) {
      this.deckStatus.render(this.deck, this.source, validate(this.deck, this.source));
    }

    if (Config.dev.focusFirstCardOnStart && all.length > 0) this.setFocus(all[0]);
    // Config is `as const`, so widen before comparing — the literal type has
    // no overlap with '' and TypeScript rejects the check otherwise.
    // Before the walls are drawn: the panel's contents depend on the stage, so
    // jumping afterwards leaves it showing the stage we skipped past.
    this.jumpToStage(String(Config.dev.startAtStage));
    this.renderWalls();

    this.loadLibrary();

    // Open on the menu, not mid-deckbuild. dev.startOnMode skips it while
    // working on one screen.
    this.setMode(Config.dev.startOnMode as AppMode);

    const askOnStart: string = Config.dev.askOnStart;
    if (askOnStart.length > 0) this.askAgent(this.promptForStage(stageOf(this.deck)));
    if (Config.dev.scanOnStart) this.runScan();
    if (Config.dev.exportOnStart) this.exportDeck();

    if (Config.dev.detectionDemo && this.cannedScanImage) {
      // Dead centre: this is the thing the demo is meant to show.
      const panel = this.makeAnchor('Detection Demo', {
        positionCm: { x: 0, y: this.eyeHeightCm + 2, z: -75 },
        yawDeg: 0,
      });
      this.detectionView = new DetectionDebugView(
        panel, this.tileMesh, this.tileMaterial, this.artMaterial, this.font, 40, 30);
    }

    if (Config.detection.worldMarkers) {
      const markerRoot = global.scene.createSceneObject('Card Markers');
      markerRoot.setParent(this.sceneObject);
      this.markerView = new CardMarkerView(markerRoot, this.tileMesh, this.tileMaterial, this.font);
    }
    console.log(`${TAG} ready — ${CATALOGUE_CARDS.length} cards from ${CATALOGUE_SOURCE}` +
      ` (${CATALOGUE_FETCHED_AT}), panel showing ${this.wall.getRowCount()} row(s)`);
  }

  /**
   * Everything is laid out relative to WHERE THE USER IS, not the world origin.
   * The contract says "250 cm from user"; anchoring to absolute coordinates
   * instead put the walls wherever the origin happened to be, which in Preview
   * meant standing inside the collection wall with every panel behind you.
   */
  private captureUserPose(): void {
    const camera = this.camera ?? this.findCamera();
    if (camera === null) {
      console.warn(`${TAG} no camera found — laying out from the world origin`);
      return;
    }
    const transform = camera.getSceneObject().getTransform();
    this.originCm = transform.getWorldPosition();

    // Derive the look direction from the rotation rather than trusting
    // Transform.forward: the docs do not say whether it is +Z or the viewing
    // direction, and Lens Studio is a -Z-forward engine. Rotating (0,0,-1) is
    // unambiguous either way.
    const look = transform.getWorldRotation().multiplyVec3(new vec3(0, 0, -1));

    // Yaw only: the layout must stay level even if the head is tilted.
    this.originYawDeg = (Math.atan2(-look.x, -look.z) * 180) / Math.PI;
    console.log(`${TAG} laying out around (${this.originCm.x.toFixed(0)}, `
      + `${this.originCm.y.toFixed(0)}, ${this.originCm.z.toFixed(0)}) `
      + `look=(${look.x.toFixed(2)},${look.y.toFixed(2)},${look.z.toFixed(2)}) `
      + `fwd=(${transform.forward.x.toFixed(2)},${transform.forward.y.toFixed(2)},${transform.forward.z.toFixed(2)}) `
      + `yaw ${this.originYawDeg.toFixed(0)}deg`);
  }

  private findCamera(): Camera | null {
    const search = (object: SceneObject): Camera | null => {
      const found = object.getComponent('Component.Camera') as Camera;
      if (found) return found;
      for (let i = 0; i < object.getChildrenCount(); i++) {
        const child = search(object.getChild(i));
        if (child !== null) return child;
      }
      return null;
    };
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      const found = search(global.scene.getRootObject(i));
      if (found !== null) return found;
    }
    return null;
  }

  /**
   * Switch screens: show that screen's panels and its controls, hide the rest.
   *
   * "Your cards" is the browse panel filtered to what you own — the same grid,
   * a different question — so it sets the owned filter on the way in and
   * releases it on the way out.
   */
  setMode(mode: AppMode): void {
    this.mode = mode;
    const show = panelsFor(mode);

    if (this.menuRoot !== null) this.menuRoot.enabled = show.menu;
    if (this.storeRoot !== null) this.storeRoot.enabled = show.stores;
    if (this.wallAnchor !== null) this.wallAnchor.enabled = show.browse;
    if (this.controlsRoot !== null) {
      this.controlsRoot.enabled = !show.menu;
      // Parent the controls to the panel they act on, so dragging that panel
      // takes its buttons with it. As an independent anchor they stayed put and
      // the panel slid out from over them.
      // Which panel the strip belongs to on this screen, and how wide that
      // panel is. Sized as well as parented: the strip used to keep the card
      // grid's width everywhere, so on the narrower screens — your decks, the
      // store finder — it hung out past both edges of the panel it serves.
      const host = show.browse ? this.wallAnchor
        : show.stores ? this.storeRoot
        : show.decks ? this.decksAnchor
        : null;
      const hostHeight = show.browse ? Config.layout.collectionWall.heightCm
        : show.stores ? STORE_PANEL_HEIGHT_CM
        : MENU_PANEL_HEIGHT_CM;
      const hostWidth = show.browse
        ? gridSpanCm(Config.layout.grid, Config.layout.tile).widthCm : SIDE_PANEL_WIDTH_CM;
      this.debug.setPanelWidth(hostWidth);
      if (host !== null) {
        this.controlsRoot.setParent(host);
        this.controlsRoot.getTransform().setLocalPosition(
          new vec3(0, -hostHeight / 2 - CONTROLS_DROP_CM, 0.4));
        this.controlsRoot.getTransform().setLocalRotation(quat.quatIdentity());
      }
    }
    if (this.deckAnchor !== null) this.deckAnchor.enabled = show.deck;
    if (this.sheetAnchor !== null) this.sheetAnchor.enabled = show.sheet;
    if (this.decksAnchor !== null) this.decksAnchor.enabled = show.decks;
    if (show.decks) this.renderLibrary();
    if (this.agentAnchor !== null) this.agentAnchor.enabled = show.agent;
    // The focus slot hides itself when nothing is focused; only force it off.
    if (this.focusRoot !== null && !show.focus) this.focusRoot.enabled = false;

    if (mode === 'cards') this.ownedOnly = true;
    else if (mode === 'deck') this.ownedOnly = false;
    this.debug.setOwnedLabel(this.ownedOnly);
    this.debug.setMode(mode);

    if (show.browse) this.renderWalls();
    // Arrival, not teleportation: the panels of the new screen pop into place.
    this.sfx.pop();
    if (show.menu) this.juice.popIn(this.menuRoot);
    if (show.browse) this.juice.popIn(this.wallAnchor);
    if (show.deck) this.juice.popIn(this.deckAnchor);
    if (show.agent) this.juice.popIn(this.agentAnchor);
    if (show.stores) this.juice.popIn(this.storeRoot);
    console.log(`${TAG} screen: ${headingFor(mode)}`);
  }

  /**
   * The shelf lives in persistent storage, so decks survive closing the Lens.
   * Read once at startup and written on every save; a corrupt blob comes back
   * as an empty shelf rather than taking the Lens down with it.
   */
  private static readonly LIBRARY_KEY = 'binder.decks.v1';

  private loadLibrary(): void {
    try {
      const store = global.persistentStorageSystem.store;
      this.library = parseLibrary(store.getString(BinderApp.LIBRARY_KEY));
      // Seed the shelf the first time, so "Your decks" is not an empty room.
    if (Config.dev.seedStarterDecks && this.library.decks.length === 0) {
      const starters = buildStarterDecks(this.source.all(), Date.now());
      for (const deck of starters) {
        this.library = saveIntoLibrary(this.library, deck, Date.now());
      }
      if (starters.length > 0) {
        this.persistLibrary();
        console.log(`${TAG} seeded ${starters.length} example deck(s)`);
      }
    }
    console.log(`${TAG} ${this.library.decks.length} saved deck(s) on the shelf`);
    } catch (e) {
      console.warn(`${TAG} could not read saved decks: ${e}`);
      this.library = emptyLibrary();
    }
  }

  private persistLibrary(): void {
    try {
      global.persistentStorageSystem.store.putString(
        BinderApp.LIBRARY_KEY, serialiseLibrary(this.library));
    } catch (e) {
      console.warn(`${TAG} could not save decks: ${e}`);
    }
  }

  private renderLibrary(): void {
    if (this.deckLibraryView === null) return;
    this.deckLibraryView.render(this.library, (id) => this.source.byId(id));
  }

  /** Re-place the whole layout in front of wherever the user is now. */
  recenter(): void {
    this.captureUserPose();
    for (const entry of this.anchors) {
      this.positionAnchor(entry.object, entry.placement);
    }
    console.log(`${TAG} recentred`);
  }

  private buildScene(): void {
    const L = Config.layout;
    this.captureUserPose();
    // Built from the domains actually present, so colours stay distinct
    // without the code ever naming a domain.
    const palette = buildDomainPalette(this.source.all().map((c) => c.domains));
    // From the cards themselves, not the palette: palette keys are normalised
    // to lower case for lookup, and echoing "fury" back at the user is wrong.
    const seen: string[] = [];
    for (const card of this.source.all()) {
      for (const domain of card.domains) if (seen.indexOf(domain) === -1) seen.push(domain);
    }
    this.knownDomains = seen;
    const art = new CardArtLoader(this.internetModule, this.remoteMediaModule);
    const deps = {
      mesh: this.tileMesh,
      materialTemplate: this.tileMaterial,
      artMaterialTemplate: this.artMaterial,
      font: this.font,
      palette,
      art,
    };

    // Three panels: the agent one head-turn left, the collection dead ahead,
    // the deck one head-turn right. At ~36 degrees FOV only one can be in view
    // at a time, which is the point — you look at the thing you are using.
    const wallRoot = this.makeAnchor('Collection Wall', wallPlacement(L.collectionWall, this.eyeHeightCm, Config.dev.layoutScale));
    this.wallAnchor = wallRoot;
    makeBillboard(wallRoot);
    this.wall = new CollectionWallView(
      wallRoot, deps, L.grid, L.tile, this.source, this.font, L.collectionWall);
    this.wall.onFocusRequest((card) => {
      // A tick as your gaze lands on a card. The scale-and-glow already says
      // "this one"; the tick is what makes sweeping a row feel like touching
      // the cards rather than pointing a torch at them.
      this.sfx.hover();
      this.setFocus(card);
    });
    // Pinching marks a card; NEXT commits it. Committing on the pinch itself
    // made every accidental tap a deck edit.
    this.wall.onPick((card) => this.dispatch({ kind: 'SELECT', cardId: card.id }));
    this.addHandle(
      wallRoot, L.collectionWall.widthCm, L.collectionWall.heightCm / 2 + 3, 'Cards');

    // Deck wall: 40 degrees to the right of the collection wall, per Config.
    const deckRoot = this.makeAnchor('Deck Wall', wallPlacement(L.deckWall, this.eyeHeightCm, Config.dev.layoutScale));
    this.deckAnchor = deckRoot;
    makeBillboard(deckRoot);
    this.deckWall = new DeckWallView(deckRoot, deps, L.deckTile, L.deckWall, this.source, this.font);

    // The finished deck as a decklist: sections, counts, battlefields in their
    // own column. The deck wall shows the CURVE, which is what you want while
    // building; this is what you want once it is built.
    const sheetRoot = this.makeAnchor(
      'Deck Sheet', wallPlacement(L.deckSheet, this.eyeHeightCm, Config.dev.layoutScale));
    this.sheetAnchor = sheetRoot;
    makeBillboard(sheetRoot);
    this.deckSheet = new DeckSheetView(
      sheetRoot, this.tileMesh, this.tileMaterial, this.artMaterial, this.font,
      palette, art, L.deckSheet.widthCm, L.deckSheet.heightCm);
    // Ask about the deck, from the deck sheet.
    this.deckSheet.onAsk(
      () => this.askAgent('look at the deck I have built and tell me what it is '
        + 'trying to do, and what it is short of'),
      () => {
        this.agentPanel.setStatus('Listening…');
        if (this.voice !== null) this.voice.start();
      },
      () => { if (this.voice !== null) this.voice.stop(); },
      () => { if (this.voice !== null) this.voice.stop(); },
    );
    const sheetHandle = this.addHandle(
      sheetRoot, L.deckSheet.widthCm, L.deckSheet.heightCm / 2 + 3, 'Deck sheet');
    // The sheet grows to fit the deck, so its grab bar has to keep up.
    // The sheet grows to fit the deck, so BOTH the things pinned to its edges
    // have to keep up: the grab bar above it and the status below. The status
    // was placed once from the CONFIGURED height, so as the sheet grew its own
    // Ask button slid down past the status and the two drew through each other.
    this.deckSheet.onResized((height) => {
      sheetHandle.followPanelHeight(height);
      if (this.deckStatusRoot !== null) {
        this.deckStatusRoot.getTransform().setLocalPosition(
          new vec3(0, -height / 2 - STATUS_DROP_CM, 0.2));
      }
    });
    this.deckWall.onFocusRequest((card) => this.setFocus(card));
    // Clear of the deck heading, which already sits above the panel edge.
    this.addHandle(deckRoot, L.deckWall.widthCm, L.deckWall.heightCm / 2 + 14, 'Deck');

    // Focus slot: floats in front of the collection wall's left edge, nearer
    // than the wall so it reads as being pulled out of the grid. Kept inside
    // the agent panel's head-turn so the two never fight for the same angle.
    // Main menu and store finder take the centre, where the browse panel is.
    const menuRoot = this.makeAnchor(
      'Main Menu', wallPlacement(L.collectionWall, this.eyeHeightCm, Config.dev.layoutScale));
    this.menuRoot = menuRoot;
    // NOT billboarded. A panel that swivels to follow you reads as the menu
    // moving every time you shift in your seat; it has a grab bar for when you
    // do want it somewhere else. The other panels still turn to face you — say
    // if those should stop too.

    this.menuView = new MainMenuView(
      menuRoot, this.tileMesh, this.tileMaterial, this.font, 62, MENU_PANEL_HEIGHT_CM);
    this.menuView.onSelect((mode) => this.setMode(mode));

    // Shared deck. Built here rather than at startup because nothing connects
    // until somebody asks: opening Binder to build a deck alone must not go
    // looking for a session, or for the room.
    const session = new DeckSession(this as unknown as ScriptComponent, {
      onDeckArrived: (deck) => this.adoptDeck(deck),
      onStatus: (message) => this.agentPanel.setStatus(message),
    });
    session.onEdit = (intent) => this.dispatch(intent);
    this.session = session;
    this.menuView.onShare(() => session.start());
    this.addHandle(menuRoot, 62, MENU_PANEL_HEIGHT_CM / 2 + 3, PROJECT_TITLE);

    const storeRoot = this.makeAnchor(
      'Store Finder', wallPlacement(L.collectionWall, this.eyeHeightCm, Config.dev.layoutScale));
    this.storeRoot = storeRoot;
    makeBillboard(storeRoot);
    this.storeView = new StoreFinderView(
      storeRoot, this.tileMesh, this.tileMaterial, this.font, 62, STORE_PANEL_HEIGHT_CM);
    this.addHandle(storeRoot, 62, STORE_PANEL_HEIGHT_CM / 2 + 3, 'Stores');

    // STRAIGHT AHEAD, shown only after a scan. It used to sit 20 degrees to the
    // left, where the focus card lives, which meant the answer to the thing you
    // had just done appeared off to one side and you had to go looking for it.
    // A scan is a deliberate act with a result worth reading, so the result
    // arrives where you are already looking.
    const scanRoot = this.makeAnchor('Scan Preview', {
      positionCm: { x: 0, y: this.eyeHeightCm + 2, z: -L.focus.distanceCm },
      yawDeg: 0,
    });
    this.scanPreviewRoot = scanRoot;
    this.scanPreview = new ScanPreviewView(
      scanRoot, this.tileMesh, this.tileMaterial, this.artMaterial, this.font, 42, 68);
    // No tap-anywhere-to-dismiss: the panel now carries Add and Close, and a
    // whole-panel dismiss would fire whenever a press missed a button.
    // Accepting a scan takes the same path a pinch does, so stage and domain
    // rules stay in one place rather than being re-implemented for scanning.
    this.scanPreview.onAdd((card) => this.dispatch({ kind: 'SELECT', cardId: card.id }));
    // Ask about what was just scanned, from the scan panel itself. The same
    // grounded path the assistant's About button uses — the card is known, so
    // nothing here has to guess which one is meant.
    this.scanPreview.onAsk((card) => {
      this.lastScanned = card;
      this.scanPreview.setNote(`Asking about ${card.name}…`);
      this.tellMeAbout(card, (line) => this.scanPreview.setNote(line));
    });
    // Hold Ask to speak. Same mic, same routing as the controls bar.
    this.scanPreview.onAskHold(
      () => {
        this.scanPreview.setNote('Listening…');
        if (this.voice !== null) this.voice.start();
      },
      () => { if (this.voice !== null) this.voice.stop(); },
      () => { if (this.voice !== null) this.voice.stop(); },
    );
    this.scanPreview.onPrice((card) => {
      this.lastScanned = card;
      this.scanPreview.setNote(`Pricing ${card.name}…`);
      this.dispatch({ kind: 'PRICE_CARD', cardId: card.id });
    });

    const decksRoot = this.makeAnchor(
      'Deck Library', wallPlacement(L.collectionWall, this.eyeHeightCm, Config.dev.layoutScale));
    this.decksAnchor = decksRoot;
    makeBillboard(decksRoot);
    this.deckLibraryView = new DeckLibraryView(decksRoot, this.font, 62, MENU_PANEL_HEIGHT_CM);
    this.deckLibraryView.onOpen((deckId) => this.dispatch({ kind: 'OPEN_DECK', deckId }));
    this.addHandle(decksRoot, 62, MENU_PANEL_HEIGHT_CM / 2 + 3, 'Your decks');

    const focusRoot = this.makeAnchor('Focus Slot', {
      positionCm: {
        x: -Math.sin((20 * Math.PI) / 180) * L.focus.distanceCm,
        y: this.eyeHeightCm + 2,
        z: -Math.cos((20 * Math.PI) / 180) * L.focus.distanceCm,
      },
      yawDeg: 20,
    });
    this.focus = new FocusSlotView(
      focusRoot, this.tileMesh, this.tileMaterial, this.artMaterial, this.font,
      L.focus.heightCm, palette, art);
    // Grab the CARD, not a bar above it. A zoomed card has no tap action of its
    // own, so its whole face can be the handle — which is both a bigger target
    // and the thing you would instinctively reach for.
    this.focusRoot = focusRoot;
    makeBillboard(focusRoot);
    makeMovable(this.focus.grabTarget(), focusRoot)
      .onManipulationEnd.add(() => this.rememberAnchor(focusRoot));

    // Debug panel: to the right of the focus slot, within arm's reach.
    // Controls live ON the card panel, below the grid, rather than floating
    // somewhere else — they act on what is in that panel, so they belong with
    // it, and a separate strip meant looking in two places to do one thing.
    // On their OWN anchor, in the same place they used to sit on the wall.
    // As a child of the browse panel they vanished with it, taking the button
    // that gets you back to the menu with them.
    const gridSpan = gridSpanCm(L.grid, L.tile);
    const controlsRoot = this.makeAnchor('Controls', {
      positionCm: {
        x: 0,
        y: this.eyeHeightCm - gridSpan.heightCm / 2 - L.controls.topOffsetCm,
        z: -L.collectionWall.distanceCm,
      },
      yawDeg: 0,
    });
    this.controlsRoot = controlsRoot;
    this.debug = new DebugPanel(
      controlsRoot, this.tileMesh, this.tileMaterial, this.font, (i) => this.dispatch(i),
      L.controls.columns, gridSpan.widthCm, 0);

    // Agent panel: a side panel in its own right, one head-turn to the left.
    const agentRoot = this.makeAnchor('Agent Panel', wallPlacement(L.agentWall, this.eyeHeightCm, Config.dev.layoutScale));
    this.agentAnchor = agentRoot;
    makeBillboard(agentRoot);
    // Deck status belongs ON the deck panel, under its grid — the same rule the
    // controls follow. As a separate floating anchor it hung over the right of
    // the collection grid and hid two columns of cards.
    // Parented to the SHEET, not the deck wall. The status used to hang off the
    // wall, so turning the wall off took the counts, the curve and the legality
    // verdict with it — the numbers you most want while building.
    const statusRoot = global.scene.createSceneObject('Deck Status');
    statusRoot.setParent(sheetRoot);
    this.deckStatusRoot = statusRoot;
    // Below the sheet, measured against the SHEET's height now that it hangs
    // there — the old offset was derived from the deck wall and would have left
    // the status floating in the middle of the decklist.
    statusRoot.getTransform().setLocalPosition(
      new vec3(0, -L.deckSheet.heightCm / 2 - STATUS_DROP_CM, 0.2));
    this.deckStatus = new DeckStatusView(
      statusRoot, this.tileMesh, this.tileMaterial, this.font, 32, 26);

    // Sits where the agent panel does, shown only on export.
    const exportRoot = this.makeAnchor('Export Panel', {
      positionCm: { x: 0, y: this.eyeHeightCm + 4, z: -92 },
      yawDeg: 0,
    });
    this.exportPanel = new ExportPanelView(exportRoot, this.tileMesh, this.tileMaterial, this.font, 40);

    this.agentPanel = new AgentPanelView(
      agentRoot, this.tileMesh, this.tileMaterial, this.artMaterial, this.font, art,
      L.agentWall);
    this.agentPanel.onFocusRequest((card) => { this.sfx.hover(); this.setFocus(card); });
    this.agentPanel.onActionRequest((action) => {
      this.sfx.press();
      if (action === 'ask') { this.openAskKeyboard(); return; }
      // "This card" is whatever you are looking at, falling back to the last
      // scan — which is exactly what a scanned card is FOR: it becomes the
      // subject of the conversation.
      const card = (this.previewedCardId !== null ? this.source.byId(this.previewedCardId) : null) ?? this.lastScanned;
      if (card === null) { this.agentPanel.setStatus('Look at a card, or scan one, then ask again.'); return; }
      if (action === 'about') { this.tellMeAbout(card); return; }
      if (action === 'price') { this.dispatch({ kind: 'PRICE_CARD', cardId: card.id }); return; }
      this.askAgent(`what pairs well with ${card.name}?`);
    });
    this.agentPanel.onAskHold(
      () => {
        this.agentPanel.setStatus('Listening…');
        if (this.voice !== null) this.voice.start();
      },
      () => { if (this.voice !== null) this.voice.stop(); },
      () => { if (this.voice !== null) this.voice.stop(); },
    );
    this.agentPanel.onAddRequest((card) => this.dispatch({ kind: 'SELECT', cardId: card.id }));
    this.addHandle(agentRoot, L.agentWall.widthCm, L.agentWall.heightCm / 2 + 3, 'Assistant');

  }

  private makeAnchor(name: string, placement: AnchorPlacement): SceneObject {
    const obj = global.scene.createSceneObject(name);
    obj.setParent(this.sceneObject);
    this.positionAnchor(obj, placement);
    this.anchors.push({ object: obj, placement });
    return obj;
  }

  /**
   * Place an anchor whose offset is expressed in USER space: -Z is straight
   * ahead of the user, +X is to their right, Y is relative to their eye line.
   * Rotating the offset by the user's yaw is what makes "in front of me" mean
   * in front of them rather than in front of the world origin.
   */
  /**
   * Record where the user has just dragged a panel to, back in USER space.
   *
   * Without this a recentre would snap the panel to the default the user had
   * deliberately moved away from — the layout would keep overruling them.
   * Rotation is not written back because the handles cannot rotate a panel;
   * the stored yaw stays authoritative so panels keep facing the user.
   */
  private rememberAnchor(obj: SceneObject): void {
    const entry = this.anchors.find((a) => a.object === obj);
    if (entry === undefined) return;

    const world = obj.getTransform().getWorldPosition();
    const rotatedX = worldToCm(world.x - this.originCm.x);
    const rotatedZ = worldToCm(world.z - this.originCm.z);
    const yawRad = (this.originYawDeg * Math.PI) / 180;
    const sin = Math.sin(yawRad);
    const cos = Math.cos(yawRad);

    entry.placement.positionCm = {
      x: rotatedX * cos - rotatedZ * sin,
      y: worldToCm(world.y - this.originCm.y),
      z: rotatedX * sin + rotatedZ * cos,
    };
  }

  /** Give a panel a grab bar, and keep its anchor in step with where it lands. */
  private addHandle(
    root: SceneObject, widthCm: number, yCm: number, label: string,
  ): PanelHandle {
    const handle = new PanelHandle(
      root, this.tileMesh, this.tileMaterial, this.font, widthCm, yCm, label);
    handle.onMoved(() => this.rememberAnchor(root));
    return handle;
  }

  private positionAnchor(obj: SceneObject, placement: AnchorPlacement): void {
    const yawRad = (this.originYawDeg * Math.PI) / 180;
    const sin = Math.sin(yawRad);
    const cos = Math.cos(yawRad);
    const offset = placement.positionCm;

    const rotatedX = offset.x * cos + offset.z * sin;
    const rotatedZ = -offset.x * sin + offset.z * cos;

    const t = obj.getTransform();
    t.setWorldPosition(new vec3(
      this.originCm.x + cmToWorld(rotatedX),
      this.originCm.y + cmToWorld(offset.y),
      this.originCm.z + cmToWorld(rotatedZ),
    ));
    // Config is degrees; the runtime is radians.
    t.setWorldRotation(quat.fromEulerAngles(0, ((placement.yawDeg + this.originYawDeg) * Math.PI) / 180, 0));
  }

  /**
   * Phase 0 has no scanner, so the wall is seeded from the catalogue to have
   * something to show. Bounded by Config.dev.seedCollectionFromCatalogue —
   * Phase 1 replaces this entirely with real scan results.
   */
  private seedFromSource(): void {
    const now = Date.now();
    const limit = Config.dev.seedCollectionFromCatalogue;
    this.source.all().slice(0, limit).forEach((card, i) => {
      this.state = addCard(this.state, card.id, now + i);
    });
  }

  /**
   * What the wall shows: everything legal to pick at this stage, narrowed by
   * the current search, ordered by domain grouping.
   *
   * There are only ~180 legends, so choosing one is a browse-and-decide task,
   * not a question worth a network round trip. The agent is for "what fits my
   * deck"; the wall is for "show me all of them".
   */
  private browsableEntries(): { cardId: string; count: number; firstScannedAt: number }[] {
    // "Your cards" is a LIBRARY, not a build step. Piping it through stagePool
    // meant an empty deck showed legends only - the deck flow's first stage -
    // so the screen was indistinguishable from the deck builder.
    const pool = this.mode === 'cards'
      ? this.source.all().slice()
      : stagePool(this.source.all(), this.deck, (id) => this.source.byId(id));
    const owned = this.ownedOnly
      ? pool.filter((card) => countOf(this.state, card.id) > 0)
      : pool;
    const filtered = applyFilter(owned, this.filter);
    // Domain grouping is the default order; any other mode replaces it.
    const ordered = this.sortMode === 'grouped'
      ? browseOrder(filtered)
      : sortCards(filtered, this.sortMode);
    // count drives the "x2" badge on a tile, so it shows how many you own
    // rather than a constant 1 that told the user nothing.
    return ordered.map((card, i) => ({
      cardId: card.id,
      count: Math.max(1, countOf(this.state, card.id)),
      firstScannedAt: i,
    }));
  }

  private renderWalls(): void {
    const entries = this.browsableEntries();
    this.wall.render(entries);
    this.deckWall.render(this.deck);
    if (this.deckSheet !== null) {
      this.deckSheet.render(buildDeckSheet(this.deck, (id) => this.source.byId(id)));
    }

    // Highlight marks what is IN THE DECK, so it is derived from the deck
    // rather than from a separate cursor that could disagree with it.
    this.wall.setIncluded((id) => isInDeck(this.deck, id));
    this.deckWall.setIncluded();
    this.agentPanel.setIncluded((id) => isInDeck(this.deck, id));

    if (this.mode === 'cards') {
      // The library speaks in what you own, never in build steps.
      const owned = this.state.entries.length;
      this.wall.setHeading(owned > 0
        ? `Your cards — ${entries.length} owned · by ${sortLabel(this.sortMode)}`
        : 'Your cards — none yet. Scan one, or pinch cards to add them.');
    } else {
      const stage = stageOf(this.deck);
      const what = stage === 'legend' ? 'Choose your Legend'
        : stage === 'champion' ? 'Choose your Champion'
        : stage === 'battlefields' ? `Choose 3 Battlefields (${this.deck.battlefieldIds.length}/3)`
        : stage === 'runes' ? 'Choose 12 Runes'
        : 'Cards for your deck';
      this.wall.setHeading(`${what} — ${entries.length} options · by ${sortLabel(this.sortMode)}`);
    }
  }

  /**
   * Exercise the detection pipeline against a still texture. Dev only — proves
   * grab, threshold, connected components and association actually run on a
   * real photograph rather than only on synthetic test frames.
   */
  /**
   * Canned image first, live camera second — the contract requires SCAN to work
   * with the camera dead, and the canned path is also the only one testable off
   * a device.
   */
  /**
   * Open the system keyboard and run what is typed as a search.
   *
   * The typed text is echoed on the agent panel because the Snap OS keyboard
   * renders its own field wherever it likes — without the echo there is no
   * confirmation in the Lens that the Lens is receiving anything.
   */
  /**
   * Grounded card facts: the model gets the card's REAL data (rules text
   * verbatim, stats, domains) and nothing else — same grounding rule as
   * suggestions, and the meta-stats prohibition is restated in the prompt.
   */
  /**
   * @param report also send the answer here — the panel the question was asked
   *        from. Without it the reply only ever lands on the assistant panel,
   *        which is a head-turn away from the scan.
   */
  private tellMeAbout(card: Card, report?: (text: string) => void): void {
    if (this.agent.isBusy()) {
      this.agentPanel.setStatus('Still thinking…');
      if (report !== undefined) report('Still thinking about the last question…');
      return;
    }
    this.agentPanel.setStatus(this.waitingLine(`About ${card.name}…`));
    this.agent.ask(
      buildCardFactsPrompt(card),
      (text) => {
        this.agentPanel.setStatus(`${card.name}`);
        this.agentPanel.setReason(text.trim());
        if (report !== undefined) report(text.trim());
        this.setFocus(card);
      },
      (error) => {
        this.agentPanel.setStatus(`Agent error: ${error}`);
        if (report !== undefined) report(`Could not answer: ${error}`);
      },
    );
  }

  /** Price a card, reporting to the assistant panel and optionally elsewhere. */
  private priceCard(card: Card, report?: (text: string) => void): void {
    if (this.agent.isBusy()) {
      this.agentPanel.setStatus('Still thinking…');
      if (report !== undefined) report('Still thinking about the last question…');
      return;
    }
    this.agentPanel.setStatus(this.waitingLine(`Pricing ${card.name}…`));
    this.agent.ask(
      buildPricePrompt(card),
      // describePrice always says "est." and always admits ignorance, so a
      // recalled figure can never be read off the panel as a quote.
      (text) => {
        const line = describePrice(card, parsePriceResponse(text));
        this.agentPanel.setStatus(line);
        if (report !== undefined) report(line);
      },
      (message) => {
        this.agentPanel.setStatus(`Could not price it: ${message}`);
        if (report !== undefined) report(`Could not price it: ${message}`);
      },
    );
  }

  /** Type a question for the agent — the spoken ask, for quiet rooms. */
  private openAskKeyboard(): void {
    if (this.searchInput.isOpen()) { this.searchInput.finish(); return; }
    this.agentPanel.setStatus('Ask: ');
    this.searchInput.request(
      '',
      (text) => this.agentPanel.setStatus(`Ask: ${text}`),
      (text) => {
        if (text.length === 0) { this.agentPanel.setStatus('Ask cancelled.'); return; }
        this.askAgent(text);
      },
    );
  }

  private openSearchKeyboard(): void {
    if (this.searchInput.isOpen()) { this.searchInput.finish(); return; }
    this.agentPanel.setStatus('Search: ');
    this.searchInput.request(
      '',
      (text) => this.agentPanel.setStatus(`Search: ${text}`),
      (text) => {
        if (text.length === 0) { this.agentPanel.setStatus('Search cancelled.'); return; }
        this.dispatch({ kind: 'SEARCH', query: text });
      },
    );
  }

  /**
   * The camera module, wired or not.
   *
   * It was an unwired @allowUndefined input, so scanCamera() failed with "no
   * camera module assigned" on every attempt and the canned image quietly took
   * over — a scan always returned the sample card whatever you held up.
   * require() gets it without anyone having to remember to drag it in.
   */
  private resolveCameraModule(): CameraModule | null {
    if (this.cameraModule) return this.cameraModule;
    try {
      return require('LensStudio:CameraModule') as CameraModule;
    } catch (e) {
      console.warn(`${TAG} no camera module available: ${e}`);
      return null;
    }
  }

  /**
   * Put the scanned frame on screen with the verdict. Runs the real detector
   * over the same frame so the box marks where a card was actually found —
   * if there is no box, the card was not in shot, whatever the model said.
   */
  private showScanPreview(caption: string, card: Card | null = null): void {
    if (this.scanPreview === null) return;
    const frame = this.scanner.frame();

    // The model's own box first: the local detector cannot outline a card
    // that fills the frame, which is exactly how a card is held up to scan.
    // Gemini reports where the card sits in 0..1000 image units regardless.
    const modelBox = this.scanner.box();
    let quad: any = modelBox;
    let size = { w: 1000, h: 1000 };
    if (quad === null && frame !== null) {
      const views = this.detector.step(frame, Date.now(), 0);
      if (views !== null && views.length > 0) {
        quad = views[0].quad;
        size = { w: Config.detection.widthPx, h: Config.detection.heightPx };
      }
    }
    // "Choose" while the legend, champion and battlefields are still being
    // settled; "Add" once the main deck is what is being filled.
    this.scanPreview.setAddLabel(stageOf(this.deck) === 'deck' ? 'Add' : 'Choose');
    this.scanPreview.show(frame, quad, size, caption, this.scanner.reply(), card);
    // The assistant follows what you just scanned. Its slots were still showing
    // whatever it last suggested, so the panel you turn to after a scan was
    // talking about a different card entirely.
    if (card !== null) {
      this.agentPanel.show(`Scanned ${card.name}`,
        [{ cardId: card.id, reason: 'Just scanned.' }], (id) => this.source.byId(id));
    }
    this.juice.popIn(this.scanPreviewRoot ?? null, 0.24);
  }

  /**
   * A tip to read while something is loading.
   *
   * The waits here are seconds long — a photograph, an upload and a model round
   * trip — and a bare "Reading the card…" gives you nothing to do with them.
   */
  private waitingLine(what: string): string {
    const picked = nextHint(this.lastHint, Math.random());
    this.lastHint = picked.index;
    return picked.text.length === 0 ? what : `${what}\n\n${picked.text}`;
  }

  private runScan(): void {
    if (this.scanner.isBusy()) { this.agentPanel.setStatus('Already scanning…'); return; }
    this.agentPanel.setStatus(this.waitingLine('Reading the card…'));

    const onResult = (result: ScanResult): void => {
      this.state = applyScan(this.state, result, Date.now());
      this.renderWalls();
      if (result.matched !== null) this.sfx.success(); else this.sfx.fail();
      if (result.matched !== null) {
        const card = this.source.byId(result.matched);
        this.agentPanel.setStatus(`Scanned ${card === null ? result.matched : card.name}.`);
        // Focus it, but do NOT commit. The preview panel offers "Add to deck"
        // and the user decides — a misread should not be able to put a card in
        // the deck without anyone agreeing to it.
        if (card !== null) { this.lastScanned = card; this.setFocus(card); }
      } else if (result.alternatives.length > 0) {
        const names = result.alternatives
          .map((id, i) => `${i + 1}. ${this.source.byId(id)?.name ?? id}`)
          .join('   ');
        this.agentPanel.setStatus(`Not sure. Say "the first one".   ${names}`);
      } else {
        this.agentPanel.setStatus(`Read "${result.rawName}" but found no match.`);
      }

      const named = result.matched === null ? null : this.source.byId(result.matched);
      this.showScanPreview(named !== null ? named.name
        : result.rawName.length > 0 ? `Read "${result.rawName}" — no match in the set`
        : 'No card text found in this frame', named);
    };
    const onError = (message: string): void => {
      this.agentPanel.setStatus(`Scan failed: ${message}`);
      console.warn(`${TAG} scan failed: ${message}`);
      this.showScanPreview(`Could not read a card — ${message}`);
    };

    // The CAMERA is the scan. The canned image is a fallback for when there is
    // no camera to read — it used to win outright, which meant every scan
    // returned the canned card no matter what you actually held up.
    const canned = this.cannedScanImage;
    if (Config.dev.useCannedScan && canned) {
      console.log(`${TAG} scanning the canned image (dev.useCannedScan)`);
      this.scanner.scanTexture(canned, onResult, onError);
      return;
    }
    // No silent fallback to the canned image. Substituting a different card
    // when the camera hiccups is worse than failing: the scan appears to work
    // and quietly adds a card you never held up.
    const rendered = this.sceneCapture;
    if (rendered !== null && rendered.frame() !== null) {
      // The rendered scene, so cards drawn by the Lens are in the picture too.
      // The capture camera renders only while a scan needs it.
      console.log(`${TAG} scanning the rendered scene`);
      // Take Binder's own interface out of shot first — it sits between the
      // wearer and the card, and would otherwise be the subject of the photo.
      rendered.exclude(this.sceneObject);
      // Refreshed per scan: requestCamera fills the texture in asynchronously,
      // so one bound at startup can still be cold.
      rendered.setBackdrop(this.scanner.liveFrame());
      rendered.setActive(true);
      const settle = this.createEvent('DelayedCallbackEvent');
      settle.bind(() => {
        const frame = rendered.frame();
        const done = (): void => rendered.setActive(false);
        if (frame === null) { rendered.setActive(false); onError('no rendered frame'); return; }
        // Freeze the pixels NOW. The render target is live, and the async
        // base64 encode samples whenever it runs — the model was reading a
        // frame from seconds after the press. The shutter sound marks the
        // exact instant that is actually captured.
        const frozen = freezeTexture(frame);
        this.sfx.shutter();
        this.scanner.scanTexture(
          frozen !== null ? frozen : frame,
          (result) => { done(); onResult(result); },
          (message) => { done(); onError(message); },
        );
      });
      // One frame is not always enough for the target to contain this frame's
      // draw; a beat is cheaper than a black capture.
      settle.reset(0.2);
      return;
    }

    console.log(`${TAG} scanning the live camera`);
    this.scanner.scanCamera(onResult, onError);
  }

  /**
   * Slide the card across a synthetic frame and run the REAL detector on it.
   * Only the camera is stood in for — detection, association and tracking are
   * the production code paths.
   */
  private stepDetectionDemo(): void {
    const nowMs = getTime() * 1000;
    if (nowMs - this.lastDetectionStepAt < Config.detection.intervalMs) return;
    this.lastDetectionStepAt = nowMs;

    // Live camera path. Device only — Preview has no camera feed, so this
    // silently produces nothing there, which is why the synthetic path exists.
    if (Config.detection.useCamera) {
      if (!this.cameraModule) return;
      if (this.liveCameraTexture === null) {
        try {
          this.liveCameraTexture = this.cameraModule.requestCamera(CameraModule.createCameraRequest());
        } catch (e) {
          console.warn(`${TAG} camera unavailable: ${e}`);
          return;
        }
      }
      const liveViews = this.detector.step(this.liveCameraTexture, nowMs, 0);
      if (liveViews === null) return;
      if (this.detectionView !== null) {
        this.detectionView.setFrame(this.liveCameraTexture);
        this.detectionView.setDetections(liveViews, Config.detection.widthPx, Config.detection.heightPx);
      }
      this.placeWorldMarkers(liveViews);
      return;
    }

    if (this.detectionView === null || !this.cannedScanImage) return;

    if (this.probeScene === null) {
      const textures: Texture[] = [this.cannedScanImage];
      for (const extra of (this.testCards ?? [])) if (extra) textures.push(extra);
      this.probeScene = ProbeSceneBuilder.create(textures, 256, 192, 58);
      this.probeGray = new Uint8Array(Config.detection.widthPx * Config.detection.heightPx);
      if (this.probeScene === null) { console.warn(`${TAG} demo: cards not readable`); return; }
      console.log(`${TAG} demo: test bed with ${this.probeScene.cardCount()} card(s)`);
    }

    const t = getTime() * 0.3;
    const count = this.probeScene.cardCount();

    // One card per quadrant, each on a small local orbit.
    //
    // Crossing paths were the first attempt and they made a poor test bed:
    // overlapping cards merge into a single blob, so four cards produced two
    // oversized boxes. Card overlap is a real limitation worth knowing about,
    // but it should not be the default state of a tracking demo.
    //
    // Card 1 also ROTATES, so the detector's tolerance to a turned card is
    // visible rather than assumed — it holds to roughly 25 degrees and is lost
    // beyond that, because the bounding box stops matching the card's aspect.
    // Well separated: the morphological close bridges gaps of roughly twice its
    // iteration count, so cards parked too near each other merge into one blob.
    const quadrants = [
      { x: 0.24, y: 0.25 }, { x: 0.76, y: 0.25 },
      { x: 0.24, y: 0.75 }, { x: 0.76, y: 0.75 },
    ];
    const placements = [];
    for (let i = 0; i < count; i++) {
      const home = quadrants[i % quadrants.length];
      const phase = t + i * 1.7;
      placements.push({
        cardIndex: i,
        centreX: home.x + Math.cos(phase) * 0.05,
        centreY: home.y + Math.sin(phase * 0.9) * 0.04,
        heightFraction: 0.30,
        rotationDeg: i === 1 ? Math.sin(t * 0.5) * 40 : 0,
      });
    }

    const gray = this.probeScene.draw(
      placements, this.probeGray as Uint8Array,
      Config.detection.widthPx, Config.detection.heightPx);
    const views = this.detector.stepGray(gray, nowMs, 0);
    if (views === null) return;

    this.detectionView.setFrame(this.probeScene.texture);
    this.detectionView.setDetections(views, Config.detection.widthPx, Config.detection.heightPx);
    this.placeWorldMarkers(views);

    if (nowMs - this.lastDetectionLogAt > 3000) {
      this.lastDetectionLogAt = nowMs;
      const rotation = placements.length > 1 ? placements[1].rotationDeg.toFixed(0) : '0';
      console.log(`${TAG} demo: ${count} card(s) placed (card 1 rotated ${rotation}deg) -> `
        + `${views.length} detected ` + views.map((v) => `${v.trackerId}@${v.quad.x},${v.quad.y}`).join(' '));
      if (views.length < count) {
        // Say WHICH threshold rejected each card rather than just a count.
        const candidates = describeCandidates(gray, Config.detection.widthPx, Config.detection.heightPx);
        for (const c of candidates.slice(0, 7)) {
          console.log(`${TAG}   [${c.mask}] ${c.quad.width}x${c.quad.height} `
            + `aspect=${c.quad.aspect.toFixed(2)} fill=${c.quad.fill.toFixed(2)} `
            + `area=${(c.quad.area / (Config.detection.widthPx * Config.detection.heightPx)).toFixed(3)} `
            + `-> ${c.reason ?? 'ACCEPTED'}`);
        }
      }
    }
  }

  /**
   * Turn detections into world-space markers.
   *
   * The detection frame is treated as the camera's view: a rectangle plus the
   * camera's field of view gives a direction, and the card's known 63x88 mm
   * size gives the distance. Camera space then goes to world through the
   * camera's own transform.
   */
  private placeWorldMarkers(views: readonly DetectionView[]): void {
    if (this.markerView === null) return;
    const camera = this.camera ?? this.findCamera();
    if (camera === null) return;

    const transform = camera.getSceneObject().getTransform();
    const eye = transform.getWorldPosition();
    const rotation = transform.getWorldRotation();
    const intrinsics = {
      frameWidthPx: Config.detection.widthPx,
      frameHeightPx: Config.detection.heightPx,
      verticalFovRad: camera.fov,
    };

    const updates: MarkerUpdate[] = [];
    for (const view of views) {
      const pose = detectionToCameraPose(
        { cx: view.quad.cx, cy: view.quad.cy, height: view.quad.height }, intrinsics);
      if (pose === null) continue;

      // Camera space -> world.
      const local = new vec3(pose.positionCm.x, pose.positionCm.y, pose.positionCm.z);
      const rotated = rotation.multiplyVec3(local);
      const world = new vec3(eye.x + rotated.x, eye.y + rotated.y, eye.z + rotated.z);

      const card = view.cardId === null ? null : this.source.byId(view.cardId);
      updates.push({
        trackerId: view.trackerId,
        worldPosition: world,
        widthCm: pose.widthCm,
        heightCm: pose.heightCm,
        caption: card !== null ? card.name : `${view.trackerId} · ${pose.distanceCm.toFixed(0)} cm`,
      });
    }
    this.markerView.setMarkers(updates);
  }

  /**
   * Pinch adds a copy; pinching at the maximum clears the card entirely.
   *
   * A straight toggle got stuck at the rune stage: twelve runes come from about
   * thirty cards, so a legal rune deck needs six copies of one card, and a
   * toggle caps everything at one.
   */
  private toggleCard(card: Card): void {
    const before = deckCount(this.deck, card.id);
    this.deck = cycleCard(this.deck, card, (id) => this.source.byId(id), Date.now(), RUNES_REQUIRED);
    const after = deckCount(this.deck, card.id);

    this.setFocus(card);
    this.afterDeckChange();

    const max = maxCopiesFor(card, this.deck, (id) => this.source.byId(id), RUNES_REQUIRED);
    if (after === 0 && before > 0) this.agentPanel.setStatus(`Removed ${card.name}.`);
    else if (max > 1) this.agentPanel.setStatus(`${card.name} x${after} (pinch again to add, ${max} max)`);
  }

  /** Re-render and re-validate. Validation reports; it never blocks an edit. */
  /**
   * Take the other person's deck as it stands.
   *
   * Deliberately NOT afterDeckChange: that fills runes and republishes, which
   * from here would bounce an edit straight back at whoever sent it. An
   * adopted deck is already finished — it is only rendered.
   */
  private adoptDeck(deck: Deck): void {
    this.deck = deck;
    this.renderWalls();
    const violations = validate(this.deck, this.source);
    if (this.deckStatus !== null) this.deckStatus.render(this.deck, this.source, violations);
    console.log(`${TAG} adopted a deck of ${mainDeckSize(this.deck)} from the other person`);
  }

  private afterDeckChange(): void {
    // Runes are mechanical: they follow the legend's domains and there is no
    // interesting choice to make, so filling them by hand was busywork with a
    // button attached. autoFillRunes returns the same deck when there is
    // nothing to add, so this cannot loop.
    this.deck = autoFillRunes(this.deck, this.source.all(),
      (id) => this.source.byId(id), Date.now(), RUNES_REQUIRED);

    // BOTH walls. The collection wall is stage-dependent — it holds legends,
    // then champions, then battlefields — so re-rendering only the deck wall
    // left it still offering legends after one had been chosen.
    this.renderWalls();

    // One seam, so every deck change reaches the other person — there are
    // eight callers and remembering to publish in each would fail on the ninth.
    if (this.session !== null) this.session.publish(this.deck);

    // The deck accepting a card: a sleeve-snap and a pulse on the status
    // panel, whose counts have just changed. Only when the deck actually grew —
    // a removal or a no-op edit should not sound like something arriving.
    const sizeNow = mainDeckSize(this.deck) + runeDeckSize(this.deck) + this.deck.battlefieldIds.length;
    if (sizeNow > this.lastDeckSize) {
      this.sfx.slot();
      this.juice.pulse(this.deckStatusRoot, 0.05, 0.22);
    }
    this.lastDeckSize = sizeNow;

    const violations = validate(this.deck, this.source);
    if (this.deckStatus !== null) this.deckStatus.render(this.deck, this.source, violations);
    const errors = errorCount(violations);
    console.log(`${TAG} deck now ${mainDeckSize(this.deck)} main — `
      + `${errors} error(s), ${violations.length - errors} warning(s)`);

    // The moment the deck becomes LEGAL is the one the whole build works
    // towards, and it used to pass without a sound. Fires only on the
    // crossing — not on every edit to an already-legal deck — and the status
    // panel pops so the eye goes to the verdict that just changed.
    if (errors === 0 && this.lastErrorCount > 0) {
      this.sfx.success();
      this.juice.popIn(this.deckStatusRoot, 0.32);
    }
    this.lastErrorCount = errors;

    const runeCount = this.deck.runes.reduce((sum, r) => sum + r.count, 0);
    const stage = stageOf(this.deck);

    if (stage === 'legend') this.agentPanel.setStatus('Pick a Champion Legend to start.');
    else if (stage === 'champion') this.agentPanel.setStatus('Now pick a Chosen Champion.');
    else if (stage === 'battlefields') {
      this.agentPanel.setStatus(`Pick 3 Battlefields — ${this.deck.battlefieldIds.length} of 3.`);
    } else if (stage === 'runes') {
      this.agentPanel.setStatus(`Runes ${runeCount} of 12 — filled from your legend.`);
    } else {
      this.agentPanel.setStatus(`Main deck ${mainDeckSize(this.deck)} of 40.`);
    }

    // Moving to a new stage re-asks on its own. Suggestions belong to the stage
    // that asked for them: leaving legend suggestions up after a legend is
    // chosen invites picking a second, and making the user press "Suggest"
    // again at every step turns a flow into a chore.
    if (stage !== this.lastStage) {
      this.lastStage = stage;
      this.dismissed = [];
      this.agentPanel.clearPicks();
      // Manual mode never calls out on its own — the agent speaks when asked.
      if (this.aiGuidance) this.askAgent(this.promptForStage(stage));
    }
  }

  /**
   * Dev shortcut: commit whatever earlier choices are needed to open at a given
   * stage. Picks the first legend that actually has a matching champion, so the
   * champion stage is satisfiable rather than stuck.
   */
  private jumpToStage(target: string): void {
    if (target === '' || target === 'legend') return;

    const all = this.source.all();
    const legends = all.filter((c) => c.type === 'legend');
    for (const legend of legends) {
      const champion = all.find((c) => matchesLegendChampion(c, legend));
      if (champion === undefined) continue;

      this.deck = addToDeck(this.deck, legend, 1, Date.now());
      if (target === 'champion') break;
      this.deck = setChosenChampion(this.deck, champion, Date.now());
      if (target === 'battlefields') break;

      const fields = all.filter((c) => c.type === 'battlefield').slice(0, 3);
      for (const field of fields) this.deck = addToDeck(this.deck, field, 1, Date.now());
      if (target === 'runes') break;

      this.deck = autoFillRunes(this.deck, all, (id) => this.source.byId(id), Date.now(), RUNES_REQUIRED);

      // Fill the main deck too, so 'deck' opens on something worth looking at.
      // An empty main deck exercises none of the sheet's grouping or wrapping.
      if (target === 'deck') {
        const playable = stagePool(all, this.deck, (id) => this.source.byId(id))
          .filter((c) => c.type === 'unit' || c.type === 'spell' || c.type === 'gear');
        for (const card of playable.slice(0, 14)) {
          this.deck = addToDeck(this.deck, card, 3, Date.now());
        }
      }
      break;
    }
    this.lastStage = stageOf(this.deck);
    console.log(`${TAG} dev: opened at stage ${this.lastStage}`);
  }

  /** What to ask the agent when the build reaches a new stage. */
  private promptForStage(stage: string): string {
    if (stage === 'champion') return 'which champion unit suits this legend';
    if (stage === 'battlefields') return 'which battlefields suit this deck';
    if (stage === 'runes') return 'what runes should this deck run';
    if (stage === 'deck') return 'what should I add to this deck next';
    return 'help me start a deck';
  }

  /**
   * Show the deck where the user can actually read it. Toggling EXPORT flips
   * between the pull list and the decklist, and closes the panel on the third
   * press.
   */
  private exportDeck(): void {
    if (this.exportPanel === null) return;

    if (this.exportPanel.isOpen() && this.showingDecklist) {
      this.exportPanel.hide();
      this.showingDecklist = false;
      return;
    }

    if (this.exportPanel.isOpen()) {
      // Second press: the decklist.
      this.showingDecklist = true;
      this.exportPanel.show(
        `${this.deck.name} — decklist`,
        exportDecklist(this.deck, this.source).split('\n'),
        'Export again to close. Scroll to read on.');
      return;
    }

    // First press: the pull list, in the order you flip through a sorted box.
    const entries = buildPullList(this.deck, this.source);
    const lines = formatPullList(entries).split('\n');
    const total = entries.reduce((sum, e) => sum + e.count, 0);
    this.showingDecklist = false;
    this.exportPanel.show(
      `Pull list — ${total} cards to find`,
      lines.length === 1 && lines[0] === '' ? ['(nothing in the deck yet)'] : lines,
      'Export again for the decklist.');

    // Still logged, for anyone reading over the wire.
    console.log(`${TAG} decklist:\n${exportDecklist(this.deck, this.source)}`);
  }

  /**
   * BINDER.md § Grounding: candidates are chosen locally, the model only ranks
   * them, and any id it returns that was not offered is dropped before display.
   */
  private askAgent(request: string): void {
    if (this.agent.isBusy()) { this.agentPanel.setStatus('Still thinking…'); return; }

    // selectCandidates keeps only the structural clauses (type, domain, energy)
    // and drops the conversational remainder itself.
    const filter = parseFilter(request, this.knownDomains);

    const candidates = selectCandidates(
      this.source.all(), this.deck, filter, (id) => this.source.byId(id),
      undefined, this.dismissed);
    if (candidates.length === 0) {
      this.agentPanel.setStatus(this.dismissed.length > 0
        ? 'That is everything that fits. Ask again to start over.'
        : stageOf(this.deck) === 'champion'
          ? 'No champion unit matches this legend\'s tag in the catalogue.'
          : 'No cards match that. Try widening it.');
      console.warn(`${TAG} no candidates for "${request}"`);
      return;
    }

    const candidateIds = candidates.map((c) => c.id);
    // Pass what the user is looking at, so "what pairs well with this" resolves.
    const focused = this.previewedCardId === null ? null : this.source.byId(this.previewedCardId);
    const prompt = buildSuggestionPrompt(
      request, candidates, this.deck, (id) => this.source.byId(id), focused);
    const stage = stageOf(this.deck);
    const stageLabel = stage === 'legend' ? 'Choosing a legend'
      : stage === 'champion' ? 'Choosing your champion'
      : stage === 'battlefields' ? 'Choosing battlefields'
      : stage === 'runes' ? 'Choosing runes' : 'Building the deck';
    this.agentPanel.setStatus(this.waitingLine(`${stageLabel} — thinking…`));
    this.agentPanel.clearPicks();
    console.log(`${TAG} asking with ${candidates.length} candidates`);

    this.agent.ask(
      prompt,
      (text) => {
        const answer = parseAgentResponse(text, candidateIds);
        if (answer.rejected.length > 0) {
          // Not a warning to hide: this is the grounding guard doing its job.
          console.warn(`${TAG} dropped ${answer.rejected.length} invented id(s): ${answer.rejected.join(', ')}`);
        }
        if (answer.picks.length === 0) {
          this.agentPanel.setStatus('No usable suggestions came back.');
          return;
        }
        this.lastOffered = answer.picks.map((p) => p.cardId);
        this.agentPanel.show(answer.summary, answer.picks, (id) => this.source.byId(id));

        // Focus the first suggestion so the focus slot is showing something
        // relevant the moment the answer lands, rather than whatever was there
        // before. It also makes the selection state visible without a gaze.
        // Preview the first suggestion so the focus slot is showing something
        // relevant — but do NOT select it. Choosing stays the user's move.
        const first = this.source.byId(answer.picks[0].cardId);
        if (first !== null) this.setFocus(first);
        console.log(`${TAG} ${answer.picks.length} grounded picks`);
      },
      (error) => {
        this.agentPanel.setStatus(`Agent error: ${error}`);
        console.warn(`${TAG} agent error: ${error}`);
      },
    );
  }

  /**
   * Gaze rested on a card. PREVIEW only — it shows the card large so you can
   * read it, and marks nothing. Selecting on hover meant you committed to
   * whatever you happened to look at last, which is no way to compare options.
   */
  private setFocus(card: Card | null): void {
    // The focus card is a deck/cards-screen thing. Without this it reappeared
    // over the main menu whenever anything called setFocus in the background.
    if (!panelsFor(this.mode).focus) return;
    this.previewedCardId = card === null ? null : card.id;
    if (card === null) this.focus.clear();
    else {
      this.focus.show(card);
      this.juice.popIn(this.focusRoot, 0.22);
    }
  }

  /** The one place an intent turns into a state change — voice and tap share it. */
  dispatch(intent: Intent): void {
    console.log(`${TAG} ${describeIntent(intent)}`);
    // A shared deck has exactly one writer. When that is not this device the
    // edit has to travel as well; applying it locally too only keeps OUR view
    // in step until the owner's authoritative deck arrives and replaces it.
    if (this.session !== null && isShareable(intent)) this.session.submit(intent);
    switch (intent.kind) {
      case 'ADD': {
        const card = this.source.byId(intent.cardId);
        if (card === null) break;
        const legend = this.deck.legendId === null ? null : this.source.byId(this.deck.legendId);

        // At the champion stage, a matching champion unit becomes the Chosen
        // Champion rather than another main-deck card — it belongs in the
        // Champion Zone, and putting it in `main` would be quietly wrong.
        if (this.deck.chosenChampionId === null && matchesLegendChampion(card, legend)) {
          this.deck = setChosenChampion(this.deck, card, Date.now());
        } else {
          this.deck = addToDeck(this.deck, card, intent.count, Date.now());
        }
        this.afterDeckChange();
        break;
      }
      case 'REMOVE': {
        const card = this.source.byId(intent.cardId);
        if (card === null) break;
        this.deck = removeFromDeck(this.deck, card, intent.count, Date.now());
        this.afterDeckChange();
        break;
      }
      case 'SEARCH':
        // Phase 2 replaces the local parser with Gemini, but the filter it
        // produces and everything downstream stay exactly the same.
        this.filter = parseFilter(intent.query, this.knownDomains);
        this.renderWalls();
        console.log(`${TAG} showing ${describeFilter(this.filter)} — ${this.browsableEntries().length} cards`);
        break;
      case 'CLEAR':
        this.filter = emptyFilter();
        this.renderWalls();
        console.log(`${TAG} filter cleared — ${this.browsableEntries().length} cards`);
        break;
      case 'SCROLL':
        // Whichever surface is in front of you is the one that scrolls.
        if (this.exportPanel !== null && this.exportPanel.isOpen()) {
          this.exportPanel.scrollBy(intent.rows * 3);
        } else {
          this.wall.scrollBy(intent.rows);
        }
        break;
      case 'FOCUS': {
        const card = intent.cardId === null ? null : this.source.byId(intent.cardId);
        this.setFocus(card);
        break;
      }
      case 'SELECT': {
        const card = intent.cardId === null ? null : this.source.byId(intent.cardId);
        if (card === null) break;
        // In the library a pinch INSPECTS. Editing the deck from "Your cards"
        // meant browsing your collection quietly rewrote whatever deck was in
        // progress - the deck is not even on screen to show it happening.
        if (this.mode === 'cards') { this.sfx.pick(); this.setFocus(card); break; }
        // Selecting IS committing. A separate confirm step made every pick two
        // gestures for no benefit — the highlight already says what is in, and
        // pinching an included card takes it back out.
        this.sfx.pick();
        this.toggleCard(card);
        break;
      }
      case 'NEXT':
        this.agentPanel.setStatus('Just pinch a card — it goes straight in.');
        break;
      // Phases 1, 4 and 5. Logged so the debug panel proves the payload shape
      // now and the handler drops in later without touching the callers.
      case 'ASK':
        this.dismissed = [];          // a fresh question starts from everything
        this.lastPrompt = intent.prompt;
        this.askAgent(intent.prompt);
        break;
      case 'TOGGLE_AI':
        this.aiGuidance = !this.aiGuidance;
        this.debug.setAiLabel(this.aiGuidance);
        if (!this.aiGuidance) {
          this.agentPanel.clearPicks();
          this.agentPanel.setStatus('Manual. Hold to ask, or turn AI back on for suggestions.');
        } else {
          this.askAgent(this.promptForStage(stageOf(this.deck)));
        }
        break;
      case 'SORT':
        this.sortMode = nextSortMode(this.sortMode);
        this.debug.setSortLabel(sortLabel(this.sortMode));
        this.renderWalls();
        break;
      case 'AUTO_RUNES': {
        const filled = autoFillRunes(this.deck, this.source.all(),
          (id) => this.source.byId(id), Date.now(), RUNES_REQUIRED);
        if (filled === this.deck) {
          this.agentPanel.setStatus('Pick a legend first — runes follow its domains.');
          break;
        }
        this.deck = filled;
        this.afterDeckChange();
        break;
      }
      case 'MORE':
        // Turn down what is on screen and ask again for something else.
        for (const id of this.lastOffered) {
          if (this.dismissed.indexOf(id) === -1) this.dismissed.push(id);
        }
        this.askAgent(this.lastPrompt);
        break;
      case 'EXPORT':
        this.exportDeck();
        break;
      case 'RECENTER':
        this.recenter();
        break;
      case 'PRICE_CARD': {
        const card = this.source.byId(intent.cardId);
        if (card === null) break;
        // Reported on the scan panel too when that is what is showing — the
        // price of a card you just scanned is wanted where you scanned it.
        this.priceCard(card, this.scanPreview !== null && this.scanPreview.isOpen()
          ? (line) => this.scanPreview.setNote(line) : undefined);
        break;
      }
      case 'SIDEBOARD': {
        const card = this.source.byId(intent.cardId);
        if (card === null) break;
        const wasHeld = this.deck.sideboard.some((s) => s.cardId === card.id);
        const next = toggleSideboard(this.deck, card, Date.now());
        if (next === this.deck) {
          this.agentPanel.setStatus(`${card.name} is not in the deck to move.`);
          break;
        }
        this.deck = next;
        this.afterDeckChange();
        const size = sideboardSize(this.deck);
        this.agentPanel.setStatus(wasHeld
          ? `${card.name} back in the main deck — sideboard ${size} of 8.`
          : `${card.name} to the sideboard — ${size} of 8.`);
        break;
      }
      case 'SAVE_DECK': {
        this.library = saveIntoLibrary(this.library, this.deck, Date.now());
        this.persistLibrary();
        this.agentPanel.setStatus(`Saved "${this.deck.name}".`);
        console.log(`${TAG} saved deck ${this.deck.id} — ${this.library.decks.length} on the shelf`);
        break;
      }
      case 'OPEN_DECK': {
        const found = findDeck(this.library, intent.deckId);
        if (found === null) { this.agentPanel.setStatus('That deck is gone.'); break; }
        this.deck = found;
        this.setMode('deck');
        this.afterDeckChange();
        this.agentPanel.setStatus(`Opened "${found.name}".`);
        break;
      }
      case 'NEW_DECK':
        this.deck = emptyDeck(`deck-${Date.now()}`, 'New Deck', Date.now());
        this.setMode('deck');
        this.afterDeckChange();
        this.agentPanel.setStatus('Started a new deck.');
        break;
      case 'FIND_STORES':
        if (this.storeView !== null) this.storeView.find();
        break;
      case 'SHOW_OWNED': {
        this.ownedOnly = !this.ownedOnly;
        this.debug.setOwnedLabel(this.ownedOnly);
        const total = this.state.entries.length;
        this.agentPanel.setStatus(this.ownedOnly
          ? `Showing the ${total} card${total === 1 ? '' : 's'} you own.`
          : 'Showing every card.');
        this.renderWalls();
        break;
      }
      case 'TOGGLE_OWNED': {
        const card = this.source.byId(intent.cardId);
        const had = countOf(this.state, intent.cardId);
        this.state = had > 0
          ? removeCard(this.state, intent.cardId, had)
          : addCard(this.state, intent.cardId, Date.now());
        const name = card === null ? intent.cardId : card.name;
        this.agentPanel.setStatus(had > 0 ? `${name} — no longer owned.` : `${name} — marked owned.`);
        this.renderWalls();
        break;
      }
      case 'SCAN':
        this.runScan();
        break;
      case 'PICK': {
        // "the second one" — resolve the newest unmatched scan.
        const index = this.state.unmatched.length - 1;
        if (index < 0) { this.agentPanel.setStatus('Nothing waiting to be picked.'); break; }
        const alternatives = this.state.unmatched[index].alternatives;
        const chosen = alternatives[intent.ordinal - 1];
        if (chosen === undefined) { this.agentPanel.setStatus(`No option ${intent.ordinal}.`); break; }
        this.state = resolveUnmatched(this.state, index, chosen, Date.now());
        this.renderWalls();
        const card = this.source.byId(chosen);
        this.agentPanel.setStatus(`Added ${card === null ? chosen : card.name}.`);
        break;
      }
        console.log(`${TAG} ${intent.kind} not implemented until its phase`);
        break;
    }
  }
}
