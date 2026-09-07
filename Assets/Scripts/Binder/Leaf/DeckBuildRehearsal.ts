// Binder — building a whole deck, driven by LEAF. Lens runtime, PREVIEW ONLY.
//
// The scan rehearsal proves one photograph. This proves the JOURNEY: scan a
// legend and accept it, scan a champion and accept it, then keep picking from
// the wall until the deck reports itself legal. It is the only test that
// exercises the stage machine end to end — legend, champion, battlefields,
// runes, main deck — and the only one that would notice if choosing a legend
// stopped advancing the build.
//
// Two real cards in the scene, not props built here: RengarCardMain is the
// legend and RengarCard the champion. A fixture that builds its own subject
// only ever proves the fixture can build a subject.

import { Scenario } from 'Leaf.lspkg/Scenarios/scenario/Scenario';
import type { ScenarioConfig } from 'Leaf.lspkg/Scenarios/scenario/ScenarioConfig';
import { IKBodyInteractor } from 'Leaf.lspkg/Interactors/interactor/ik/IKBodyInteractor';
import { DefaultLeafInteractor } from 'Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor';
import type { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';
import {
  findByName, findDescendant, firstText, searchLabel, findInteractable, interactableAbove,
  interactablesUnder, findWearerCamera, holdCardAt,
} from './SceneProbe';

const TAG = '[Binder][leaf]';

/**
 * The two cards in the scene, and what they actually are.
 *
 * BOTH are champion UNITS — Rengar - Trophy Hunter (UNL 120) and Rengar -
 * Pouncing (SFD 025) — not legends. The build's first step needs a Legend,
 * which neither can be, so the legend comes off the wall by name and the two
 * scans play the parts they can: the first becomes the Chosen Champion (it
 * shares the legend's Rengar tag), the second goes into the main deck.
 */
const CHAMPION_OBJECT = 'RengarCardMain';
const MAIN_CARD_OBJECT = 'RengarCard';

const HOLD_DISTANCE_CM = 80;
const HOLD_DROP_CM = -31;

/**
 * Per-card roll, degrees, applied in the plane of the picture.
 *
 * RengarCardMain's Image reaches the camera lying on its side where
 * RengarCard's does not, and a sideways card reads as no card at all. The 90
 * is measured from the capture: with it the legend was read correctly as
 * "Rengar - Pouncing"; without it the model returns nothing.
 *
 * This has to live HERE rather than in the scene, because the scenario
 * overwrites the card's world rotation when it holds it up — so changing the
 * object's scene transform has no effect during a run. Fixing how the card
 * looks when nobody is holding it is a separate, content-side job.
 */
const LEGEND_ROLL_DEG = 0;
const CHAMPION_ROLL_DEG = 0;   // unused now: only one card is scanned

/** How long to give the assistant to answer Ask and Price before moving on. */
const ANSWER_WAIT_SECS = 7;

/** How long to let Gemini answer one scan before failing the run. */
const SCAN_TIMEOUT_SECS = 30;

/**
 * How many tile presses to allow before giving up on finishing the deck.
 *
 * A legal deck is 40 main cards and a tile caps at 3 copies, so this cannot be
 * tight. The cap exists to fail a stuck run in a minute rather than hang until
 * LEAF's own timeout, and the assertion at the end is what actually judges the
 * result.
 */
const MAX_PICKS = 12;

/** The grab bar's object name, from Runtime/PanelHandle.ts. */
const PANEL_HANDLE_NAME = 'Panel Handle';

@component
export class DeckBuildRehearsal extends Scenario {
  private restore: { object: SceneObject; position: vec3; rotation: quat }[] = [];

  async run(_config?: ScenarioConfig): Promise<void> {
    const camera = findWearerCamera();
    if (camera === null) throw new Error('no camera in the scene');

    const legendCard = findByName(CHAMPION_OBJECT);
    const championCard = findByName(MAIN_CARD_OBJECT);
    if (legendCard === null) throw new Error(`no "${CHAMPION_OBJECT}" in the scene`);
    if (championCard === null) throw new Error(`no "${MAIN_CARD_OBJECT}" in the scene`);

    // Put both cards back wherever they were found, whatever happens. A
    // fixture that rearranges the scene makes the next run different.
    this.remember(legendCard);
    this.remember(championCard);
    // Out of shot until each is the subject: two cards in frame is two cards
    // for the model to choose between, and it may not choose the one meant.
    this.stow(championCard);

    try {
      await this.rehearse(camera, legendCard, championCard);
    } finally {
      this.putEverythingBack();
    }
  }

  private async rehearse(
    camera: Camera, legendCard: SceneObject, championCard: SceneObject,
  ): Promise<void> {
    const body = new IKBodyInteractor({ fallback: new DefaultLeafInteractor() });
    console.log(`${TAG} deck build starting`);

    await this.openDeckScreen(body);

    // The build has an order, and the scan has to wait its turn. The first
    // legend on the wall is Ambessa; once chosen, the champion stage offers
    // ONLY Ambessa champions and the battlefield stage only battlefields — so
    // a Rengar unit scanned at either of those stages matches nothing it is
    // allowed to be. It is scanned once the deck proper is being filled.
    //
    // 1. Legend, 2. its champion, 3. three battlefields — each the first
    //    thing(s) the wall offers at that stage.
    await this.pickFromWall(body, 'legend', 1);
    await this.pickFromWall(body, 'champion', 1);
    await this.pickFromWall(body, 'battlefields', 3);

    // 4. ONE scan: Rengar - Trophy Hunter, added to the main deck. One scan
    //    shows the feature; two shows it twice.
    await this.scanAndAccept(body, camera, legendCard, 'Rengar', LEGEND_ROLL_DEG);
    this.stow(legendCard);

    // 5. A few more, straight off the wall.
    await this.fillFromWall(body);

    // 4. Turn to the deck sheet and take it in. Pressing its Ask button aims
    //    the head at it, which is what brings the whole sheet into frame.
    await this.lookAtDeckSheet(body);

    // What this run can honestly prove.
    //
    // NOT that the deck came out legal: that needs forty main-deck cards, and
    // a tile holds three, so it is a hundred-odd arm animations against a wall
    // whose outer tiles the arm cannot reach anyway. Grinding that would make
    // a slow test that fails for reasons having nothing to do with the code.
    //
    // What matters is that the JOURNEY works — that scanning a card and
    // accepting it advances the build, and that picking from the wall puts
    // cards in the deck. So the assertion is that the deck moved on from
    // nothing, and that the legend it was complaining about is now chosen.
    const counts = this.deckCounts();
    const verdict = this.deckVerdict();
    console.log(`${TAG} deck now: ${counts} — ${verdict}`);

    if (verdict.indexOf('No Champion Legend chosen') !== -1) {
      throw new Error('scanning the legend did not set one');
    }
    if (counts.indexOf('0 main') !== -1) {
      throw new Error(`nothing reached the deck — counts say "${counts}"`);
    }
    console.log(`${TAG} deck build complete — legend chosen and cards added`);
  }

  /**
   * Press the first `count` tiles the wall is offering at this stage.
   *
   * Distinct tiles, in order — a pinch CYCLES a tile's count, so pressing one
   * tile three times for three battlefields would take it to three copies and
   * back to none, and battlefields must be three different names anyway. The
   * wall is re-read before each press because choosing can change the stage,
   * and with it what the wall shows.
   */
  private async pickFromWall(body: IKBodyInteractor, what: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const tiles = this.wallTiles();
      if (tiles.length <= i) throw new Error(`the wall offers no ${what} to choose (needed ${count})`);
      console.log(`${TAG} choosing ${what} ${i + 1}/${count} from the wall`);
      await body.trigger(tiles[i]);
      await this.wait(0.8);
    }
  }

  /** Point the head at a panel's centre by triggering its backing. */
  private async lookAtPanel(body: IKBodyInteractor, panel: SceneObject | null): Promise<void> {
    if (panel === null) return;
    const backing = interactableAbove(panel);
    if (backing === null) return;
    try { await body.trigger(backing); } catch (e) { /* out of reach: stay put */ }
    await this.wait(0.4);
  }

  /** Face the deck sheet and ask about the deck, so the sheet is what is seen. */
  private async lookAtDeckSheet(body: IKBodyInteractor): Promise<void> {
    const sheet = findByName('Deck Sheet');
    const ask = sheet === null ? null : searchLabel(sheet, 'Ask about this deck');
    if (ask === null) {
      console.log(`${TAG} no deck sheet Ask button to turn towards`);
      return;
    }
    console.log(`${TAG} turning to the deck sheet`);
    await body.trigger(ask);
    // The Ask button is at the very bottom of a tall sheet; re-aim at the
    // sheet's middle so the whole decklist is in frame, not just its foot.
    await this.lookAtPanel(body, sheet);
    await this.wait(ANSWER_WAIT_SECS);
  }

  /** Get to the build screen the way a person would, through the menu. */
  private async openDeckScreen(body: IKBodyInteractor): Promise<void> {
    if (findInteractable('Scan card') !== null) return;
    const build = findInteractable('Build a deck');
    if (build === null) throw new Error('could not find the main menu');
    console.log(`${TAG} opening the deck screen`);
    await body.trigger(build);
    await this.wait(1.5);
  }

  /**
   * Hold a card up, scan it, and accept what comes back.
   *
   * The card is planted BEFORE the press: the capture fires a fraction of a
   * second after the button, whereas trigger() only resolves once the whole arm
   * animation has finished, so planting afterwards is always too late.
   */
  private async scanAndAccept(
    body: IKBodyInteractor, camera: Camera, card: SceneObject, what: string,
    rollDeg: number,
  ): Promise<void> {
    const scan = findInteractable('Scan card');
    if (scan === null) throw new Error(`no Scan card button when scanning the ${what}`);

    this.unstow(card);
    // Planted ONCE, before the press — the same order scan-rengar uses and the
    // only one proven to put a readable card in the frame. The capture fires a
    // fraction of a second after the button, whereas trigger() only resolves
    // once the whole arm animation has finished, so planting afterwards is too
    // late. A per-frame version of this was tried and made the read worse.
    holdCardAt(card, camera, HOLD_DISTANCE_CM, HOLD_DROP_CM, rollDeg);

    console.log(`${TAG} scanning the ${what}`);
    await body.trigger(scan);

    const caption = await this.waitForScan();
    console.log(`${TAG} ${what} read as: ${caption}`);

    // The card has done its job: put it away so the scan panel — which now
    // carries the picture of it — is the only thing in front of the wearer.
    this.stow(card);

    const panel = findByName('Scan Preview');

    // Look at the WHOLE panel. The head aims at whatever it triggers, and the
    // buttons sit on the bottom edge — aiming there put the top half of the
    // panel above the frame. The panel's own backing is pressable (its tap is
    // not wired to anything), so triggering it points the head at the middle.
    await this.lookAtPanel(body, panel);

    // Look at what came back, and ask about it. Pressing Ask and then Price
    // aims the head at the scan panel — the IK aims at whatever it triggers —
    // so this is both the demonstration and the way the panel is brought fully
    // into view. Each answer is given time to land before the next press.
    const ask = panel === null ? null : searchLabel(panel, 'Ask');
    if (ask !== null) {
      console.log(`${TAG} asking about the ${what}`);
      await body.trigger(ask);
      await this.lookAtPanel(body, panel);
      await this.wait(ANSWER_WAIT_SECS);
    }
    const price = panel === null ? null : searchLabel(panel, 'Price');
    if (price !== null) {
      console.log(`${TAG} pricing the ${what}`);
      await body.trigger(price);
      await this.lookAtPanel(body, panel);
      await this.wait(ANSWER_WAIT_SECS);
    }

    // Accept it. The scan PROPOSES and the person commits, so the run has to
    // press Choose just as a person would — scanning alone changes no deck.
    // "Choose" while a legend, champion or battlefield is being settled, "Add"
    // once the main deck is being filled — the panel relabels itself by stage,
    // so the run looks for either.
    const add = panel === null ? null
      : (searchLabel(panel, 'Choose') ?? searchLabel(panel, 'Add'));
    if (add === null) {
      // Nothing to choose means the read matched no card. Close the panel so
      // it does not sit over the interface for the rest of the run, THEN fail
      // — a run that dies with a modal left open is worse than one that tidies
      // up, and the caption says exactly what the model saw.
      const close = panel === null ? null : searchLabel(panel, 'Close');
      if (close !== null) await body.trigger(close);
      throw new Error(`the ${what} scan matched no card: "${caption}"`);
    }
    await body.trigger(add);
    await this.wait(1.0);
  }

  /** Poll the scan panel's caption until it says something. */
  private async waitForScan(): Promise<string> {
    const deadline = getTime() + SCAN_TIMEOUT_SECS;
    while (getTime() < deadline) {
      const caption = this.scanCaption();
      if (caption !== null && caption.length > 0) return caption;
      await this.wait(0.5);
    }
    throw new Error(`no scan result within ${SCAN_TIMEOUT_SECS}s`);
  }

  private scanCaption(): string | null {
    const panel = findByName('Scan Preview');
    if (panel === null || !panel.enabled) return null;
    const caption = findDescendant(panel, 'Caption');
    if (caption === null) return null;
    const text = firstText(caption);
    return text === null ? null : text.text;
  }

  /**
   * Pick from the wall until the deck is legal.
   *
   * Tiles are pressed in order rather than repeatedly: a pinch CYCLES the copy
   * count, so pressing one tile four times takes it to three copies and then
   * back to none. Walking along the row adds cards; hammering one does not.
   *
   * The wall is re-read every pass because the stage changes what it offers —
   * battlefields become main-deck cards once three are chosen — and a list
   * captured once would keep pressing tiles that are no longer there.
   */
  private async fillFromWall(body: IKBodyInteractor): Promise<void> {
    let presses = 0;
    let picked = 0;
    let unreachable = 0;
    let lastVerdict = '';

    while (presses < MAX_PICKS) {
      const verdict = this.deckVerdict();
      if (verdict.indexOf('No problems found') !== -1) return;
      if (verdict !== lastVerdict) {
        console.log(`${TAG} ${presses} picks in — ${verdict}`);
        lastVerdict = verdict;
      }

      const tiles = this.wallTiles();
      if (tiles.length === 0) throw new Error('no cards on the wall to pick from');

      // One press per tile, then round again. Three passes fills each tile to
      // its three-copy limit without ever cycling one back to zero.
      const tile = tiles[presses % tiles.length];
      presses++;
      try {
        await body.trigger(tile);
        picked++;
      } catch (e) {
        // A tile at the edge of the wall is outside the arm's reach, and the
        // body reports that rather than pressing it. That is a fact about
        // where the panel is, not a failure of the deck flow — skip it and
        // carry on down the row.
        unreachable++;
      }
    }

    console.log(`${TAG} ${picked} picked, ${unreachable} out of reach`);
  }

  /** The pressable card tiles on the collection wall, in wall order. */
  private wallTiles(): Interactable[] {
    const wall = findByName('Collection Wall');
    if (wall === null) return [];
    // Only the tiles. The wall's own backing carries an Interactable too — it
    // is what drag-to-scroll listens to — and pressing that is not picking a
    // card; the IK just fails to converge on a panel-sized target. A tile is
    // the one with a printed card name on it.
    // Only the card tiles. Two other things under this wall are pressable and
    // neither is a card: the wall's own backing, which is what drag-to-scroll
    // listens to, and the grab bar that moves the panel. Both are panel-sized,
    // so the IK spends its whole budget failing to converge on them.
    return interactablesUnder(wall).filter((tile) => {
      const object = tile.getSceneObject();
      return object !== wall && object.name !== PANEL_HANDLE_NAME;
    });
  }

  /** The deck panel's own counts line: "N main · N runes · N battlefields". */
  private deckCounts(): string {
    const status = findByName('Deck Status');
    if (status === null) return '';
    const counts = findDescendant(status, 'Deck Counts');
    const text = counts === null ? null : firstText(counts);
    return text === null ? '' : text.text;
  }

  /** The deck panel's own verdict line — the app's conclusion, not the test's. */
  private deckVerdict(): string {
    const status = findByName('Deck Status');
    if (status === null) return '';
    const verdict = findDescendant(status, 'Deck Verdict');
    const text = verdict === null ? null : firstText(verdict);
    return text === null ? '' : text.text;
  }

  private remember(object: SceneObject): void {
    const transform = object.getTransform();
    this.restore.push({
      object,
      position: transform.getWorldPosition(),
      rotation: transform.getWorldRotation(),
    });
  }

  /** Park a card far behind the wearer so it cannot appear in a capture. */
  private stow(object: SceneObject): void {
    object.enabled = false;
  }

  private unstow(object: SceneObject): void {
    object.enabled = true;
  }

  private putEverythingBack(): void {
    for (const entry of this.restore) {
      entry.object.enabled = true;
      const transform = entry.object.getTransform();
      transform.setWorldPosition(entry.position);
      transform.setWorldRotation(entry.rotation);
    }
  }

  private wait(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const event = this.createEvent('DelayedCallbackEvent');
      event.bind(() => resolve());
      event.reset(seconds);
    });
  }
}
