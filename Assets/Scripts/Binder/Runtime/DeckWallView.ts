// Binder — the deck wall. Lens runtime.
//
// One column per energy value, so the curve IS the layout rather than a chart
// the user has to go and look at (BINDER.md § Spatial layout). Legend,
// battlefields and runes sit in a separate row beneath the main deck, since
// they are not part of the curve.

import type { Card, CardSource, Deck } from '../Core/Types';
import type { TileSpec, WallSpec } from '../Core/Layout';
import { layoutDeckByEnergy } from '../Core/Layout';
import { CardTileView, TileDeps } from './CardTileView';
import { makeLabel } from './ViewUtils';
import { makeCanvas, makeBackPlate } from './UIKitUtils';

export class DeckWallView {
  private readonly tiles: CardTileView[] = [];
  private readonly heading: Text;

  constructor(
    private readonly root: SceneObject,
    private readonly deps: TileDeps,
    private readonly tile: TileSpec,
    private readonly wall: WallSpec,
    private readonly source: CardSource,
    font: Font,
  ) {
    makeCanvas(this.root);
    makeBackPlate(this.root, wall.widthCm, wall.heightCm);

    this.heading = makeLabel(this.root, font, {
      name: 'Deck Heading', xCm: 0, yCm: wall.heightCm / 2 + 6, zCm: 0,
      widthCm: wall.widthCm, heightCm: 8,
    });
  }

  private onSelect: (card: Card) => void = () => {};

  /** Gazing a deck tile focuses it, same as the collection wall. */
  onFocusRequest(enter: (card: Card) => void): void {
    this.onSelect = enter;
  }

  render(deck: Deck): void {
    const layout = layoutDeckByEnergy(deck, (id) => this.source.byId(id), this.tile, this.wall);

    let used = 0;
    for (const placement of layout.placements) {
      const card = this.source.byId(placement.cardId);
      if (card === null) continue;
      // Copies are already expanded into one placement each, so the count badge
      // would be wrong here — the column height is the count.
      this.tileAt(used++).show(card, 1, placement.xCm, placement.yCm);
    }

    // Legend, battlefields and runes are not part of the curve; give them a row
    // of their own below it rather than distorting the energy columns.
    const extras: string[] = [];
    if (deck.legendId !== null) extras.push(deck.legendId);
    for (const id of deck.battlefieldIds) extras.push(id);
    for (const slot of deck.runes) for (let n = 0; n < slot.count; n++) extras.push(slot.cardId);

    const stepX = this.tile.widthCm + this.tile.gutterCm;
    const originX = -((Math.max(0, extras.length - 1)) * stepX) / 2;
    const yCm = -this.wall.heightCm / 2 - this.tile.heightCm * 0.75;
    extras.forEach((id, i) => {
      const card = this.source.byId(id);
      if (card === null) return;
      this.tileAt(used++).show(card, 1, originX + i * stepX, yCm);
    });

    for (let i = used; i < this.tiles.length; i++) this.tiles[i].hide();

    const mainCount = deck.main.reduce((sum, s) => sum + s.count, 0);
    const runeCount = deck.runes.reduce((sum, s) => sum + s.count, 0);
    this.heading.text = `${deck.name} — ${mainCount} main, ${runeCount} runes`;
  }

  /** Deck-wall tiles are all in the deck by definition. */
  setIncluded(): void {
    for (const tile of this.tiles) tile.setSelected(true);
  }

  advance(deltaSeconds: number): void {
    for (const tile of this.tiles) tile.advance(deltaSeconds);
  }

  private tileAt(index: number): CardTileView {
    while (this.tiles.length <= index) {
      const tile = new CardTileView(
        this.root, this.deps, `Deck Tile ${this.tiles.length}`, this.tile.widthCm, this.tile.heightCm);
      tile.onHover((card) => this.onSelect(card));
      this.tiles.push(tile);
    }
    return this.tiles[index];
  }
}
