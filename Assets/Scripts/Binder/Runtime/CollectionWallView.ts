// Binder — the card panel. Lens runtime.
//
// A SCROLLING panel, not a paged wall. Paging meant the visible tile count had
// to grow with the pool, and every tile carries a collider and an Interactable
// — at 200 the preview stopped responding to input entirely. Scrolling breaks
// that link: 180 legends move through 32 slots.
//
// Masking is done by CULLING rather than a stencil: a tile whose row has moved
// outside the panel is disabled, so nothing renders past the edge. Half-tiles
// are not clipped mid-way — they disappear a row early — which is the honest
// trade for not having a real mask, and at this tile size it reads cleanly.
//
// Scrolling is smoothed, so a scroll reads as movement rather than a jump.

import type { Card, CardSource, CollectionEntry } from '../Core/Types';
import type { GridSpec, TileSpec, WallSpec } from '../Core/Layout';
import { tileCentreCm, gridSpanCm } from '../Core/Layout';
import { Config } from '../Core/Config';
import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';
import { CardTileView, TileDeps } from './CardTileView';
import { makeLabel } from './ViewUtils';
import { makeCanvas, makeBackPlate } from './UIKitUtils';

/** Higher settles faster. */
const SCROLL_RATE = 12;

/**
 * How far the hand may travel before a press stops counting as a tap. Small
 * enough that a deliberate pick still registers, large enough to absorb the
 * wobble of pinching in mid-air.
 */
// Distance from where the pinch started, not the summed path: the pinch point
// jitters by a few cm as the fingers close, and summing that jitter turned
// every tap into a "drag" and stopped cards being selectable.
/**
 * Rows moved per centimetre of drag, as a multiple of 1:1.
 *
 * Kept at 1:1. The drag point is the interactor's ray cursor, which sits ON the
 * panel 150 cm away, so a few degrees of wrist rotation sweeps it tens of
 * centimetres — the distance already amplifies the hand a long way. Adding gain
 * on top of that made the grid feel like it was flinching away from you.
 */
const SCROLL_GAIN = 1.0;

const DRAG_THRESHOLD_CM = 2.5;

export class CollectionWallView {
  private readonly tiles: CardTileView[] = [];
  private entries: CollectionEntry[] = [];
  private heading: Text | null = null;

  /** Scroll position in ROWS. Fractional while animating. */
  private scroll = 0;
  private scrollTarget = 0;
  private laidOutAt = -1;

  private hoverEnter: (card: Card) => void = () => {};
  private onSelect: (card: Card) => void = () => {};

  /**
   * Pinch-drag state. Tracked for a press on ANY part of the panel, tiles
   * included: cards cover nearly the whole surface, so listening only on the
   * background meant a drag could only start in the gaps between them — which
   * is why scrolling appeared not to work at all.
   */
  private dragInteractor: any = null;
  private dragOriginCm: number | null = null;
  private dragLastY: number | null = null;
  private dragTravelCm = 0;
  private pressedTile: CardTileView | null = null;

  constructor(
    private readonly root: SceneObject,
    private readonly deps: TileDeps,
    private readonly grid: GridSpec,
    private readonly tile: TileSpec,
    private readonly source: CardSource,
    font: Font | null = null,
    wall: WallSpec | null = null,
  ) {
    if (wall !== null) {
      // A backing panel, so the grid reads as a surface rather than cards
      // floating in mid-air. UIKit brings its own Interactable with it, so the
      // drag-to-scroll listener attaches to that rather than to a hand-made
      // quad behind the cards — which is also what stops the backing competing
      // with the tiles for a pinch.
      makeCanvas(root);
      const plate = makeBackPlate(root, wall.widthCm, wall.heightCm);

      // Inside onInitialized: the BackPlate creates its Interactable as part of
      // its own start-up, so immediately after createComponent there is nothing
      // to attach to and the drag listener silently binds to nothing.
      plate.onInitialized.add(() => {
        const grab = root.getComponent(Interactable.getTypeName()) as Interactable;
        if (grab === null) {
          console.warn('[Binder] wall backing has no Interactable — scrolling is off');
          return;
        }
        grab.onTriggerStart.add((event) => this.beginDrag((event as any).interactor, null));
        grab.onTriggerEnd.add(() => this.endDrag());
        // A drag almost always releases with the ray somewhere else, and SIK
        // reports that as onTriggerEndOutside. Without it the drag never ends.
        grab.onTriggerEndOutside.add(() => this.endDrag());
        grab.onTriggerCanceled.add(() => this.endDrag());
      });
    }

    if (font !== null) {
      const span = gridSpanCm(grid, tile);
      this.heading = makeLabel(root, font, {
        name: 'Panel Heading', xCm: 0, yCm: span.heightCm / 2 + 5.5, zCm: 0.2,
        widthCm: span.widthCm, heightCm: 6, role: 'Headline2',
      });
    }
  }

  setHeading(text: string): void {
    if (this.heading !== null) this.heading.text = text;
  }

  onFocusRequest(enter: (card: Card) => void): void { this.hoverEnter = enter; }
  onPick(handler: (card: Card) => void): void { this.onSelect = handler; }

  /** Rows that exist beyond the visible window. */
  private maxScroll(): number {
    const rows = Math.ceil(this.entries.length / this.grid.cols);
    return Math.max(0, rows - this.grid.rows);
  }

  scrollBy(rows: number): void {
    this.scrollTarget = Math.max(0, Math.min(this.maxScroll(), this.scrollTarget + rows));
  }

  getScroll(): number { return this.scroll; }
  getRowCount(): number { return Math.ceil(this.entries.length / this.grid.cols); }

  render(entries: readonly CollectionEntry[]): void {
    this.entries = entries.slice();
    this.scrollTarget = Math.max(0, Math.min(this.maxScroll(), this.scrollTarget));
    this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll));
    this.laidOutAt = -1;      // force a re-layout
    this.layout();
  }

  advance(deltaSeconds: number): void {
    this.trackDrag();
    if (Math.abs(this.scrollTarget - this.scroll) > 0.001) {
      const k = 1 - Math.exp(-SCROLL_RATE * Math.max(0, deltaSeconds));
      this.scroll += (this.scrollTarget - this.scroll) * k;
      this.layout();
    }
    for (const tile of this.tiles) tile.advance(deltaSeconds);
  }

  /**
   * Convert vertical hand movement into scroll while a drag is held.
   *
   * Content follows the hand: drag DOWN and the rows move down, which means the
   * scroll position decreases. Inverting that feels like pushing a scrollbar
   * rather than moving the cards, and reads wrong on a direct-manipulation
   * surface.
   */
  private beginDrag(interactor: any, tile: CardTileView | null): void {
    this.dragInteractor = interactor;
    this.dragLastY = null;
    this.dragOriginCm = null;
    this.dragTravelCm = 0;
    this.pressedTile = tile;
  }

  /**
   * A release is a pick only if the hand stayed put. Past the threshold it was
   * a scroll, and picking a card the user was merely dragging past would be
   * infuriating.
   */
  private endDrag(): void {
    const tile = this.pressedTile;
    const travelled = this.dragTravelCm;
    this.dragInteractor = null;
    this.dragLastY = null;
    this.dragOriginCm = null;
    this.dragTravelCm = 0;
    this.pressedTile = null;

    if (tile === null || travelled > DRAG_THRESHOLD_CM) return;
    const card = tile.currentCard();
    if (card !== null) this.onSelect(card);
  }

  /**
   * The live point under the hand. `endPoint` is the interactor's cursor and is
   * recomputed every frame; `planecastPoint` is a ray-plane intersection against
   * whichever Interactable is currently targeted, so it jumps between tiles as
   * the hand sweeps and freezes when the ray leaves the pressed tile. That made
   * it useless as a scroll source.
   */
  private dragPoint(): vec3 | null {
    const it = this.dragInteractor;
    if (it === null || it === undefined) return null;
    const point = it.endPoint ?? it.startPoint ?? null;
    return point === undefined ? null : point;
  }

  /**
   * The wall's own up axis. Dragging is measured along the panel, not along
   * world Y, so a tilted or yawed wall still scrolls with the hand.
   */
  private wallUp(): vec3 {
    return this.root.getTransform().getWorldRotation().multiplyVec3(new vec3(0, 1, 0));
  }

  private trackDrag(): void {
    if (this.dragInteractor === null) return;
    const point = this.dragPoint();
    if (point === null) return;

    const alongCm = point.dot(this.wallUp());
    if (this.dragOriginCm === null) this.dragOriginCm = alongCm;
    if (this.dragLastY !== null) {
      const deltaCm = alongCm - this.dragLastY;
      this.dragTravelCm = Math.abs(alongCm - (this.dragOriginCm ?? alongCm));
      const stepY = this.tile.heightCm + this.tile.gutterCm;
      // Dragging the cards up brings later rows into view, so the scroll index
      // moves with the hand.
      const rows = (deltaCm / stepY) * SCROLL_GAIN;
      const max = this.maxScroll();
      // Move the TARGET only and let advance() ease the grid toward it. Writing
      // this.scroll directly tracked the hand exactly, which also meant it
      // tracked the ray's jitter exactly; the easing is what makes a drag read
      // as a scroll rather than a twitch.
      this.scrollTarget = Math.max(0, Math.min(max, this.scrollTarget + rows));
    }
    this.dragLastY = alongCm;
  }

  setIncluded(isIncluded: (cardId: string) => boolean): void {
    for (const tile of this.tiles) {
      const id = tile.cardId();
      tile.setSelected(id !== null && isIncluded(id));
    }
  }

  /**
   * Place tiles for the rows currently within the panel. Only the visible
   * window is populated, so the tile pool stays small however large the
   * catalogue is.
   */
  private layout(): void {
    if (this.laidOutAt === this.scroll) return;
    this.laidOutAt = this.scroll;

    const counts = new Map<string, number>();
    for (const entry of this.entries) counts.set(entry.cardId, entry.count);

    const stepY = this.tile.heightCm + this.tile.gutterCm;
    const firstRow = Math.floor(this.scroll);
    const visibleRows = this.grid.rows + 1;      // one spare for the partial row

    let used = 0;
    for (let r = 0; r < visibleRows; r++) {
      const row = firstRow + r;
      for (let col = 0; col < this.grid.cols; col++) {
        const index = row * this.grid.cols + col;
        if (index < 0 || index >= this.entries.length) continue;

        const entry = this.entries[index];
        const card = this.source.byId(entry.cardId);
        if (card === null) continue;

        // Row 0 sits at the top of the grid; scrolling slides everything up.
        const base = tileCentreCm(col, row, this.grid, this.tile);
        const y = base.yCm + this.scroll * stepY;

        // Cull outside the panel — this is the masking.
        const halfPanel = (this.grid.rows * stepY) / 2;
        if (y > halfPanel || y < -halfPanel) continue;

        const tile = this.tileAt(used++);
        tile.show(card, counts.get(entry.cardId) ?? 1, base.xCm, y);
      }
    }
    for (let i = used; i < this.tiles.length; i++) this.tiles[i].hide();
  }

  private tileAt(index: number): CardTileView {
    while (this.tiles.length <= index) {
      const tile = new CardTileView(
        this.root, this.deps, `Tile ${this.tiles.length}`, this.tile.widthCm, this.tile.heightCm);
      tile.onHover((card) => this.hoverEnter(card));
      // Press starts a possible drag; release picks the card only if the hand
      // barely moved. Selecting on PRESS would fire on every scroll.
      tile.onPress(
        (interactor) => this.beginDrag(interactor, tile),
        () => this.endDrag(),
      );
      this.tiles.push(tile);
    }
    return this.tiles[index];
  }
}
