// Binder — the tap debug panel. Lens runtime.
//
// BINDER.md § Interaction: "Voice and camera both fail on demo day; the
// recorded video must be able to run without either." Every row builds the
// SAME Intent payload the voice path will build, so this is a genuine
// fallback rather than a parallel code path that drifts.
//
// Gaze-dependent intents (ADD / REMOVE) act on the last focused card, which is
// what gaze would have supplied.

import { Config } from '../Core/Config';
import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button';
import type { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate';
import type { Intent } from '../Core/Intents';
import * as I from '../Core/Intents';
import { resizeBorder } from './PanelBorder';
import { makeCanvas, makeBackPlate, makeObject, makeText, addButtonRim, tintButtonFill, feelPress, BUTTON_LABEL_Z } from './UIKitUtils';

interface Row {
  label: string;
  build: () => Intent | null;
  /** Marks the button whose label reflects the current sort mode. */
  sort?: boolean;
  /** Press and HOLD rather than tap — used for talking to the agent. */
  hold?: boolean;
  /** Marks the button whose label reflects whether AI guidance is on. */
  ai?: boolean;
  /** Opens the system keyboard rather than dispatching an intent. */
  search?: boolean;
  /** Marks the button whose label reflects the owned filter. */
  owned?: boolean;
  /** Which screens this control belongs to. Absent means every screen. */
  modes?: string[];
  /** Returns to the main menu rather than dispatching an intent. */
  menu?: boolean;
}

interface Control {
  /** The button's own root, so a screen can hide the controls it does not use. */
  object: SceneObject;
  label: Text;
  base: string;
  /** Kept so the strip can be resized when it moves to a narrower panel. */
  button: Button;
}

export class DebugPanel {
  private readonly rows: Row[];
  private readonly buttons: Control[] = [];
  private plate: BackPlate | null = null;
  private onHoldStart: (() => void) | null = null;
  private onHoldEnd: (() => void) | null = null;
  private onSearchTap: (() => void) | null = null;
  private focusedCardId: string | null = null;
  private firstCardId: string | null = null;
  private onMenuTap: (() => void) | null = null;
  private cols = 5;
  private gapCm = 0.6;
  private rowHeightCm = 3.4;
  private buttonWidthCm = 15;
  private originXCm = 0;

  constructor(
    private readonly root: SceneObject,
    mesh: RenderMesh,
    materialTemplate: Material,
    private readonly font: Font,
    private readonly dispatch: (intent: Intent) => void,
    /** Buttons per row. A single column is a tall list; a grid fits a panel. */
    columns = 1,
    private panelWidthCm = 21,
    private readonly topYCm = 0,
  ) {
    // Deliberately short. This is the fallback control surface, not the
    // product: BINDER.md requires every intent to be reachable without voice or
    // camera, but a fourteen-row list is taller than the visible field at this
    // FOV and buries the deckbuilder behind its own debug UI.
    // Six, not fourteen. BINDER.md requires every intent to be reachable
    // without voice or camera, but a long list of controls is itself clutter —
    // and the ones that belong to a card (focus, add) now happen by looking at
    // and tapping the card, which is where they should have been all along.
    this.rows = [
      { label: 'Suggest cards',   build: () => I.ask('suggest cards for this deck'), modes: ['deck'] },
      { label: 'Sort: Domain',    build: () => I.sort(), sort: true, modes: ['deck', 'cards'] },
      // Search opens the system keyboard; 'Units under 4' was a canned stand-in
      // for it and has nothing left to do. Runes fill themselves now, so that
      // button is gone too.
      { label: 'Search',          build: () => null, search: true, modes: ['deck', 'cards'] },
      { label: 'Scan card',       build: () => I.scan(), modes: ['deck', 'cards'] },
      { label: 'Owned: all',      build: () => I.showOwned(), owned: true, modes: ['deck'] },
      { label: 'Mark owned',      build: () => this.needsFocus((id) => I.toggleOwned(id)), modes: ['cards'] },
      { label: 'Find stores',     build: () => I.findStores(), modes: ['stores'] },
      { label: 'Show everything', build: () => I.clear(), modes: ['deck', 'cards'] },
      { label: 'Export deck',     build: () => I.exportDeck(), modes: ['deck'] },
      { label: 'Save deck',       build: () => I.saveDeck(), modes: ['deck'] },
      { label: 'Sideboard',       build: () => this.needsFocus((id) => I.sideboard(id)), modes: ['deck'] },
      { label: 'New deck',        build: () => I.newDeck(), modes: ['decks'] },
      // Held, not tapped: talking is a press-and-hold, and releasing sends.
      { label: 'Hold to ask',     build: () => null, hold: true, modes: ['deck', 'cards'] },
      { label: 'AI: on',          build: () => I.toggleAi(), ai: true, modes: ['deck'] },
      { label: 'Menu',            build: () => null, menu: true },
    ];

    // Laid out as a grid across the panel it sits on, rather than a tall list
    // floating on its own. Controls belong with the thing they act on.
    const cols = Math.max(1, columns);
    const gapCm = Config.layout.controls.gapCm;
    const rowHeightCm = cols > 1 ? Config.layout.controls.rowHeightCm : 3.0;
    const widthCm = cols > 1 ? (this.panelWidthCm - gapCm * (cols - 1)) / cols : 17;
    const originX = cols > 1 ? -(this.panelWidthCm - widthCm) / 2 : 0;

    // A real surface behind the controls. They used to float as loose plates
    // on whatever panel they happened to be parented to.
    makeCanvas(this.root);
    this.plate = makeBackPlate(this.root, this.panelWidthCm + 2, rowHeightCm * 2 + gapCm + 2);

    this.cols = cols;
    this.gapCm = gapCm;
    this.rowHeightCm = rowHeightCm;
    this.buttonWidthCm = widthCm;
    this.originXCm = originX;

    // Every control is built once; a screen shows the subset it needs and the
    // rest are disabled. Rebuilding the panel on every screen change would
    // churn colliders SIK has already registered.
    this.rows.forEach((row, i) => {
      this.buildRow(row, i, 0, this.topYCm, widthCm, rowHeightCm, mesh, materialTemplate);
    });
  }

  /** Lets the FOCUS debug row target something without a gaze ray. */
  setFirstCard(cardId: string | null): void {
    this.firstCardId = cardId;
  }

  /** The renderer tells the panel what gaze is currently on. */
  setFocusedCard(cardId: string | null): void {
    this.focusedCardId = cardId;
  }

  private needsFocus(build: (cardId: string) => Intent): Intent | null {
    if (this.focusedCardId === null) {
      console.warn('[Binder] debug: no focused card — gaze a tile first');
      return null;
    }
    return build(this.focusedCardId);
  }

  /** Live label for the sort button, so it always reads the current mode. */
  setSortLabel(mode: string): void {
    for (let i = 0; i < this.rows.length; i++) {
      if (this.rows[i].sort !== true) continue;
      this.buttons[i].base = `Sort: ${mode}`;
      this.buttons[i].label.text = this.buttons[i].base;
    }
  }

  /** Live label for the AI toggle. */
  /** Reflects whether the browse panel is showing everything or only yours. */
  setOwnedLabel(ownedOnly: boolean): void {
    const index = this.rows.findIndex((r) => r.owned === true);
    if (index === -1 || index >= this.buttons.length) return;
    const label = ownedOnly ? 'Owned: yours' : 'Owned: all';
    this.rows[index].label = label;
    this.buttons[index].base = label;
    this.buttons[index].label.text = label;
  }

  setAiLabel(on: boolean): void {
    for (let i = 0; i < this.rows.length; i++) {
      if (this.rows[i].ai !== true) continue;
      this.buttons[i].base = on ? 'AI: on' : 'AI: off';
      this.buttons[i].label.text = this.buttons[i].base;
    }
  }

  /** Hold-to-talk wiring for the button marked `hold`. */
  /** The search button asks the app to open the keyboard; it has no intent. */
  onSearch(handler: () => void): void { this.onSearchTap = handler; }

  /** Back to the main menu. */
  onMenu(handler: () => void): void { this.onMenuTap = handler; }

  /**
   * Show only the controls belonging to `mode`, packed from the top-left so
   * there are no holes where another screen's buttons would have been.
   */
  /**
   * Match the strip to the panel it currently sits under.
   *
   * The controls were sized once from the card grid, so on the narrower
   * screens — your decks, the store finder — the strip hung out past both
   * edges of the panel it belongs to. Call this BEFORE setMode; the layout
   * that follows reads these numbers.
   */
  setPanelWidth(widthCm: number): void {
    if (widthCm <= 0 || widthCm === this.panelWidthCm) return;
    this.panelWidthCm = widthCm;
    const buttonWidth = this.cols > 1
      ? (widthCm - this.gapCm * (this.cols - 1)) / this.cols : 17;
    this.buttonWidthCm = buttonWidth;
    this.originXCm = this.cols > 1 ? -(widthCm - buttonWidth) / 2 : 0;

    // Every button was BUILT at the old width, so moving them is not enough —
    // the face, its rim and the label's box all have to come with it, or the
    // strip narrows while the buttons in it stay wide and overlap.
    const h = this.rowHeightCm;
    for (const control of this.buttons) {
      control.button.size = new vec3(buttonWidth, h, 1);
      resizeBorder(control.object, buttonWidth, h, { radiusCm: 1.2, thicknessCm: 0.22 });
      control.label.layoutRect = Rect.create(
        -(buttonWidth - 0.5) / 2, (buttonWidth - 0.5) / 2, -(h * 0.6) / 2, (h * 0.6) / 2);
    }
  }

  setMode(mode: string): void {
    // Counted BEFORE anything is placed. The rows stack downwards while the
    // plate is centred on the root, so the layout has to know how many lines
    // there will be in order to start high enough for the last one to still
    // land inside the panel. Laying out first and sizing afterwards is what
    // left the third row of controls sitting outside its own border.
    const shownIndices: number[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      const rowModes = this.rows[i].modes;
      const shown = rowModes === undefined || rowModes.indexOf(mode) !== -1;
      const button = this.buttons[i];
      if (button === undefined) continue;
      button.object.enabled = shown;
      if (shown) shownIndices.push(i);
    }

    const lines = Math.max(1, Math.ceil(shownIndices.length / this.cols));
    const spanCm = lines * this.rowHeightCm + (lines - 1) * this.gapCm;
    // Centre the block of rows on the panel rather than hanging it from the top.
    const topCm = this.topYCm + (spanCm - this.rowHeightCm) / 2;

    for (let slot = 0; slot < shownIndices.length; slot++) {
      const button = this.buttons[shownIndices[slot]];
      if (button === undefined) continue;
      const col = slot % this.cols;
      const line = Math.floor(slot / this.cols);
      button.object.getTransform().setLocalPosition(new vec3(
        this.originXCm + col * (this.buttonWidthCm + this.gapCm),
        topCm - line * (this.rowHeightCm + this.gapCm),
        0.1,
      ));
    }

    // Hug the controls this screen actually shows: the stores screen has two,
    // and a plate sized for ten would be a slab of empty surface.
    if (this.plate !== null && shownIndices.length > 0) {
      const height = spanCm + 2;
      this.plate.size = new vec2(this.panelWidthCm + 2, height);
      // The rim is a mesh, so it does not follow the plate on its own.
      resizeBorder(this.root, this.panelWidthCm + 2, height);
    }
  }

  onHold(start: () => void, end: () => void): void {
    this.onHoldStart = start;
    this.onHoldEnd = end;
  }

  /** UIKit animates its own hover and press states, so there is nothing to step. */
  advance(_deltaSeconds: number): void {}

  private buildRow(
    row: Row, index: number, xCm: number, yCm: number, widthCm: number, heightCm: number,
    _mesh: RenderMesh, _materialTemplate: Material,
  ): void {
    const obj = makeObject(
      this.root, `Debug ${index} ${row.label}`, new vec3(xCm, yCm, 0.1));

    const button = obj.createComponent(Button.getTypeName()) as Button;
    button.size = new vec3(widthCm, heightCm, 1);
    addButtonRim(obj, widthCm, heightCm);
    tintButtonFill(button);
    feelPress(button, obj);

    // Lifted off the button face, or the leading glyph is clipped by it.
    const labelObject = makeObject(obj, 'Label', new vec3(0, 0, BUTTON_LABEL_Z));
    const label = makeText(labelObject, this.font, 'Text', row.label, {
      role: 'Button', widthCm: widthCm - 0.5, heightCm: heightCm * 0.6,
    });

    this.buttons.push({ object: obj, label, base: row.label, button });

    if (row.hold === true) {
      // Talking is press-and-hold: down opens the mic, up sends what was heard.
      button.onTriggerDown.add(() => {
        if (this.onHoldStart !== null) this.onHoldStart();
      });
      button.onTriggerUp.add(() => {
        if (this.onHoldEnd !== null) this.onHoldEnd();
      });
      return;
    }

    button.onTriggerUp.add(() => {
      if (row.menu === true) {
        if (this.onMenuTap !== null) this.onMenuTap();
        return;
      }
      if (row.search === true) {
        if (this.onSearchTap !== null) this.onSearchTap();
        return;
      }
      const intent = row.build();
      if (intent !== null) this.dispatch(intent);
    });
  }

}
