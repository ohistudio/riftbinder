// Binder — the finished deck, printed. Lens runtime.
//
// The deck WALL sorts by energy so the curve is the layout, which is what you
// want mid-build. This is the other half: the deck as a decklist, in sections,
// with counts — how a deck is written down and how every deck site prints one.
//
// Tiles here carry NO Interactable and no collider. A sheet is forty-odd cards
// and they are read, not pressed; giving each one a collider is what made the
// preview stop responding to input the last time this project rendered a wall
// that size.

import type { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate';
import type { DeckSheet, SheetEntry } from '../Core/DeckSheet';
import { sheetHeightCm } from '../Core/DeckSheet';
import type { Card } from '../Core/Types';
import { domainColor, DomainPalette } from '../Core/DomainColor';
import { TILE_ART, aspectOf } from '../Core/CardArt';
import { makePlate, makeLabel, resizePlate } from './ViewUtils';
import { CardArtLoader } from './CardArtLoader';
import { resizeBorder } from './PanelBorder';
import { makeCanvas, makeBackPlate, makeObject, makeText, makeButton } from './UIKitUtils';

/** Small: a sheet trades legibility of any one card for seeing the whole deck. */
// Bigger than they were (9.0 x 11.6). The sheet is the only deck view now and
// sits at 120 cm rather than 165, so the cards can be read rather than counted;
// the grid drops from eight across to six and the panel grows to suit, which is
// space it had going spare.
/** Longer than this and the press was someone speaking, not tapping. */
const ASK_HOLD_SECS = 0.35;
const TILE_W = 12.4;
const TILE_H = 16.0;
const GAP = 1.2;
/** The left column: legend, champion, battlefields. */
const COLUMN_W = 22;

interface SlotViews {
  root: SceneObject;
  plate: SceneObject;
  plateMaterial: Material;
  art: SceneObject;
  artMaterial: Material;
  name: Text;
  count: Text;
  request: number;
}

export class DeckSheetView {
  private readonly slots: SlotViews[] = [];
  private readonly headings: Text[] = [];
  private used = 0;
  private headingsUsed = 0;
  private readonly title: Text;

  constructor(
    private readonly root: SceneObject,
    private readonly mesh: RenderMesh,
    private readonly materialTemplate: Material,
    private readonly artMaterialTemplate: Material,
    private readonly font: Font | null,
    private readonly palette: DomainPalette,
    private readonly art: CardArtLoader,
    private readonly widthCm: number,
    private readonly heightCm: number,
  ) {
    makeCanvas(root);
    this.plate = makeBackPlate(root, widthCm, heightCm);
    this.content = makeObject(root, 'Sheet', new vec3(0, 0, 0.6));

    this.currentHeightCm = heightCm;
    // Keep the WRAPPER: makeText builds its Text on a child of what it is
    // given, so moving the returned Text later moves it relative to the
    // wrapper and the offset lands twice.
    this.titleObject = makeObject(this.content, 'Deck Name', new vec3(0, heightCm / 2 - 5, 0.2));
    this.title = makeText(this.titleObject, font, 'Text', '',
      { role: 'Title2', widthCm: widthCm - 8 });

    // Ask about the DECK, from the deck. Hold to speak, tap for a read of what
    // is on the sheet — the same gesture the scan panel and the assistant use,
    // so it means the same thing wherever you meet it.
    this.askObject = makeObject(this.content, 'Ask Row',
      new vec3(0, -heightCm / 2 + 5, 0.4));
    const askButton = makeButton(this.askObject, font, 'Ask about this deck', 30, 5.5, () => {});
    askButton.onTriggerDown.add(() => {
      this.askHeldAt = getTime();
      if (this.onAskHoldStart !== null) this.onAskHoldStart();
    });
    askButton.onTriggerUp.add(() => {
      if (getTime() - this.askHeldAt < ASK_HOLD_SECS) {
        if (this.onAskHoldCancel !== null) this.onAskHoldCancel();
        if (this.onAskDeck !== null) this.onAskDeck();
        return;
      }
      if (this.onAskHoldEnd !== null) this.onAskHoldEnd();
    });
  }

  /** Tap: ask about the deck. Hold: open the mic and ask in your own words. */
  onAsk(tap: () => void, start: () => void, end: () => void, cancel: () => void): void {
    this.onAskDeck = tap;
    this.onAskHoldStart = start;
    this.onAskHoldEnd = end;
    this.onAskHoldCancel = cancel;
  }

  private readonly askObject: SceneObject | null = null;
  private onAskDeck: (() => void) | null = null;
  private onAskHoldStart: (() => void) | null = null;
  private onAskHoldEnd: (() => void) | null = null;
  private onAskHoldCancel: (() => void) | null = null;
  private askHeldAt = 0;
  private readonly content: SceneObject;
  private readonly plate: BackPlate;
  /** Grown to fit whatever the deck turned out to be. */
  private currentHeightCm: number;
  private readonly titleObject: SceneObject;
  private onResize: (heightCm: number) => void = () => {};

  /** Told when the sheet resizes, so the grab bar can stay above it. */
  onResized(handler: (heightCm: number) => void): void { this.onResize = handler; }

  /** Draw the sheet. Everything is repositioned from scratch each time. */
  render(sheet: DeckSheet): void {
    this.used = 0;
    this.headingsUsed = 0;
    this.title.text = sheet.name.length > 0 ? sheet.name : 'Untitled deck';

    const left = -this.widthCm / 2 + 3;
    const gridWidthForFit = this.widthCm / 2 - 3 - (left + COLUMN_W + 2);
    const perRowForFit = Math.max(1, Math.floor((gridWidthForFit + GAP) / (TILE_W + GAP)));

    // Size the surface to the deck BEFORE laying anything on it. A fixed height
    // was fine until the sideboard appeared and ran off the bottom.
    const needed = sheetHeightCm(sheet, {
      tileHeightCm: TILE_H, gapCm: GAP, perRow: perRowForFit,
      headingCm: 4, sectionGapCm: 1.5, topCm: 12, bottomCm: 6,
    });
    const previous = this.currentHeightCm;
    this.currentHeightCm = Math.max(this.heightCm, needed);
    this.plate.size = new vec2(this.widthCm, this.currentHeightCm);
    resizeBorder(this.root, this.widthCm, this.currentHeightCm);
    if (this.currentHeightCm !== previous) this.onResize(this.currentHeightCm);
    this.titleObject.getTransform().setLocalPosition(
      new vec3(0, this.currentHeightCm / 2 - 5, 0.2));

    // The sheet grows with the deck, so the button is placed on every render
    // rather than once — otherwise it stays where a shorter sheet left it.
    if (this.askObject !== null) {
      this.askObject.getTransform().setLocalPosition(
        new vec3(0, -this.currentHeightCm / 2 + 5, 0.4));
    }

    const top = this.currentHeightCm / 2 - 12;

    // Left column: the three things chosen once.
    let y = top;
    y = this.column(left, y, 'LEGEND', sheet.legend === null ? [] : [sheet.legend]);
    y = this.column(left, y, 'CHAMPION', sheet.champion === null ? [] : [sheet.champion]);
    this.column(left, y, `BATTLEFIELDS  //  ${sheet.battlefields.length}`, sheet.battlefields);

    // Right block: the deck proper, section by section.
    const gridLeft = left + COLUMN_W + 2;
    const gridWidth = this.widthCm / 2 - 3 - gridLeft;
    const perRow = Math.max(1, Math.floor((gridWidth + GAP) / (TILE_W + GAP)));

    let gy = top;
    gy = this.heading(gridLeft, gy, `MAIN DECK  //  ${sheet.mainTotal} CARDS`);
    for (const part of sheet.main) {
      gy = this.section(gridLeft, gy, perRow, `${part.title}  //  ${part.total} CARDS`, part.entries);
    }
    if (sheet.runes.total > 0) {
      gy = this.section(gridLeft, gy, perRow, `RUNES  //  ${sheet.runes.total} CARDS`, sheet.runes.entries);
    }
    // Always drawn, even empty: "where is the side deck?" is a fair question to
    // ask of a decklist that silently omits the section when it holds nothing.
    this.section(gridLeft, gy, perRow,
      sheet.sideboard.total > 0
        ? `SIDEBOARD  //  ${sheet.sideboard.total} CARDS`
        : 'SIDEBOARD  //  EMPTY',
      sheet.sideboard.entries);

    for (let i = this.used; i < this.slots.length; i++) this.slots[i].root.enabled = false;
    for (let i = this.headingsUsed; i < this.headings.length; i++) {
      this.headings[i].getSceneObject().enabled = false;
    }
  }

  /** A labelled stack in the left column. Returns the next free y. */
  private column(x: number, y: number, title: string, cards: Card[]): number {
    let cursor = this.heading(x, y, title);
    for (const card of cards) {
      this.place(this.slotAt(this.used++), card, 1, x + TILE_W / 2, cursor - TILE_H / 2);
      cursor -= TILE_H + GAP;
    }
    return cursor - 1.5;
  }

  /** A section header plus its cards, wrapped. Returns the next free y. */
  private section(
    x: number, y: number, perRow: number, title: string, entries: SheetEntry[],
  ): number {
    let cursor = this.heading(x, y, title);
    let column = 0;
    for (const entry of entries) {
      if (entry.card === null) continue;
      const cx = x + column * (TILE_W + GAP) + TILE_W / 2;
      this.place(this.slotAt(this.used++), entry.card, entry.count, cx, cursor - TILE_H / 2);
      column++;
      if (column >= perRow) { column = 0; cursor -= TILE_H + GAP; }
    }
    if (column > 0) cursor -= TILE_H + GAP;
    return cursor - 1.5;
  }

  /** Left-aligned section label. Returns the y below it. */
  private heading(x: number, y: number, text: string): number {
    const label = this.headingAt(this.headingsUsed++);
    label.getSceneObject().enabled = true;
    label.text = text;
    // Left-aligned by placing a wide box starting at x.
    label.getSceneObject().getTransform().setLocalPosition(new vec3(x + 14, y - 1.4, 0.2));
    return y - 4;
  }

  private headingAt(index: number): Text {
    while (this.headings.length <= index) {
      const object = makeObject(this.content, `Heading ${this.headings.length}`);
      const text = makeText(object, this.font, 'Text', '', {
        role: 'Caption', tone: 'secondary', widthCm: 28, heightCm: 3,
      });
      text.horizontalAlignment = HorizontalAlignment.Left;
      this.headings.push(text);
    }
    return this.headings[index];
  }

  private place(slot: SlotViews, card: Card, count: number, xCm: number, yCm: number): void {
    const request = ++slot.request;
    slot.root.enabled = true;
    slot.root.getTransform().setLocalPosition(new vec3(xCm, yCm, 0));

    const aspect = aspectOf(card);
    let h = TILE_H;
    let w = h * aspect;
    if (w > TILE_W) { w = TILE_W; h = w / aspect; }
    resizePlate(slot.plate, this.mesh, w, h);
    resizePlate(slot.art, this.mesh, w, h);

    const rgb = domainColor(card.domains, this.palette);
    slot.plateMaterial.mainPass.baseColor = new vec4(rgb.r, rgb.g, rgb.b, 1);
    // The name is a FALLBACK, not a caption. A loaded card already prints its
    // own name across the middle of the art, so drawing ours on top of it
    // printed every title twice and clipped our copy at the tile edge. It shows
    // only while there is no art to show, and is switched off when art arrives.
    slot.name.text = card.name;
    slot.name.enabled = true;
    slot.name.getTransform().setLocalPosition(new vec3(0, -h * 0.36, 0.06));
    // The count is the whole point of a decklist; blank at one copy so the
    // sheet is not littered with x1.
    slot.count.text = count > 1 ? `x${count}` : '';
    slot.count.getTransform().setLocalPosition(new vec3(w * 0.32, h * 0.38, 0.06));

    slot.art.enabled = false;
    this.art.load(card, TILE_ART, (texture) => {
      if (slot.request !== request) return;   // slot was recycled to another card
      if (texture === null) return;           // keep the colour + name fallback
      slot.artMaterial.mainPass.baseTex = texture;
      slot.art.enabled = true;
      // The art carries the card's own title; ours would sit on top of it.
      slot.name.enabled = false;
    });
  }

  private slotAt(index: number): SlotViews {
    while (this.slots.length <= index) {
      const root = makeObject(this.content, `Sheet Card ${this.slots.length}`);
      const plate = makePlate(root, this.mesh, this.materialTemplate, TILE_W, TILE_H, 0);
      const art = makePlate(root, this.mesh, this.artMaterialTemplate, TILE_W, TILE_H, 0.03);
      art.object.enabled = false;

      const name = makeText(makeObject(root, 'Name'), this.font, 'Text', '', {
        role: 'Caption', widthCm: TILE_W * 0.92, heightCm: TILE_H * 0.16,
        shrink: true,
      });
      const count = makeText(makeObject(root, 'Count'), this.font, 'Text', '', {
        role: 'Subheadline', widthCm: TILE_W * 0.4, heightCm: TILE_H * 0.18,
      });

      this.slots.push({
        root,
        plate: plate.object,
        plateMaterial: plate.material,
        art: art.object,
        artMaterial: art.material,
        name,
        count,
        request: 0,
      });
    }
    return this.slots[index];
  }
}
