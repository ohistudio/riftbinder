// Binder — wall layout. Pure functions, no Lens Studio runtime.
//
// Coordinates are WALL-LOCAL centimetres: origin at the wall's centre,
// +x right, +y up (Lens Studio is right-handed, +Y up). The renderer applies
// the wall's own transform; nothing here knows about world space.
//
// Paging stability (BINDER.md § Tests): tiles are ordered by scan time, so a
// card added mid-session appends to the end and never reflows a tile the user
// is already looking at. Sorting by name or cost would reshuffle on every scan.

import type { Card, CollectionEntry, Deck } from './Types.ts';

export interface TileSpec { widthCm: number; heightCm: number; gutterCm: number }
export interface GridSpec { cols: number; rows: number }
export interface WallSpec { widthCm: number; heightCm: number }

export interface Placement {
  cardId: string;
  /** Wall-local centre of the tile, cm. */
  xCm: number;
  yCm: number;
  widthCm: number;
  heightCm: number;
  /** Column/row within the page, for renderers that animate by index. */
  col: number;
  row: number;
}

export interface PagedLayout {
  placements: Placement[];
  page: number;
  pageCount: number;
  perPage: number;
}

/** Total span a grid occupies, including internal gutters (no outer margin). */
export function gridSpanCm(grid: GridSpec, tile: TileSpec): { widthCm: number; heightCm: number } {
  const widthCm = grid.cols * tile.widthCm + Math.max(0, grid.cols - 1) * tile.gutterCm;
  const heightCm = grid.rows * tile.heightCm + Math.max(0, grid.rows - 1) * tile.gutterCm;
  return { widthCm, heightCm };
}

/** True when the grid fits the wall face. Checked by the renderer at startup. */
export function gridFitsWall(grid: GridSpec, tile: TileSpec, wall: WallSpec): boolean {
  const span = gridSpanCm(grid, tile);
  return span.widthCm <= wall.widthCm && span.heightCm <= wall.heightCm;
}

/** Wall-local centre of the tile at (col, row). Row 0 is the top row. */
export function tileCentreCm(
  col: number,
  row: number,
  grid: GridSpec,
  tile: TileSpec,
): { xCm: number; yCm: number } {
  const span = gridSpanCm(grid, tile);
  const stepX = tile.widthCm + tile.gutterCm;
  const stepY = tile.heightCm + tile.gutterCm;
  const originX = -span.widthCm / 2 + tile.widthCm / 2;
  const originY = span.heightCm / 2 - tile.heightCm / 2;
  return { xCm: originX + col * stepX, yCm: originY - row * stepY };
}

/**
 * Collection order: scan order, oldest first, cardId as the tiebreaker so the
 * result is deterministic when two scans share a timestamp.
 */
export function collectionOrder(entries: readonly CollectionEntry[]): CollectionEntry[] {
  return entries
    .slice()
    .sort((a, b) => (a.firstScannedAt - b.firstScannedAt) || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0));
}

/** Lay out one page of the collection wall. */
export function layoutCollection(
  entries: readonly CollectionEntry[],
  grid: GridSpec,
  tile: TileSpec,
  page: number,
): PagedLayout {
  const perPage = grid.cols * grid.rows;
  const ordered = collectionOrder(entries);
  const pageCount = Math.max(1, Math.ceil(ordered.length / perPage));
  const clamped = Math.min(Math.max(0, page), pageCount - 1);
  const slice = ordered.slice(clamped * perPage, clamped * perPage + perPage);

  const placements = slice.map((entry, i) => {
    const col = i % grid.cols;
    const row = Math.floor(i / grid.cols);
    const centre = tileCentreCm(col, row, grid, tile);
    return {
      cardId: entry.cardId,
      xCm: centre.xCm,
      yCm: centre.yCm,
      widthCm: tile.widthCm,
      heightCm: tile.heightCm,
      col,
      row,
    };
  });

  return { placements, page: clamped, pageCount, perPage };
}

/**
 * Deck wall: one column per ENERGY value, so the curve IS the layout.
 *
 * Energy is the deckbuilding cost; might and power are combat stats and do not
 * belong on this axis. Cards with no energy at all (legends, battlefields, some
 * runes) get a column of their own at the right-hand end rather than being
 * folded into energy 0, which would misread the curve.
 */
export function layoutDeckByEnergy(
  deck: Deck,
  byId: (cardId: string) => Card | null,
  tile: TileSpec,
  wall: WallSpec,
): { placements: Placement[]; columnCosts: (number | null)[] } {
  const columns = new Map<number, string[]>();
  const nullCost: string[] = [];

  for (const slot of deck.main) {
    const card = byId(slot.cardId);
    const cost = card !== null ? card.energy : null;
    for (let n = 0; n < slot.count; n++) {
      if (cost === null) nullCost.push(slot.cardId);
      else {
        const bucket = columns.get(cost);
        if (bucket === undefined) columns.set(cost, [slot.cardId]);
        else bucket.push(slot.cardId);
      }
    }
  }

  const costs = Array.from(columns.keys()).sort((a, b) => a - b);
  const columnCosts: (number | null)[] = costs.slice();
  const buckets: string[][] = costs.map((c) => columns.get(c) as string[]);
  if (nullCost.length > 0) { columnCosts.push(null); buckets.push(nullCost); }

  const cols = buckets.length;
  const rows = buckets.reduce((max, b) => (b.length > max ? b.length : max), 0);
  if (cols === 0 || rows === 0) return { placements: [], columnCosts: [] };

  // Overlap is impossible by construction; overflow is possible, so squeeze the
  // step (not the tile) until the stack fits the wall face.
  const stepX = Math.min(tile.widthCm + tile.gutterCm, wall.widthCm / cols);
  const stepY = Math.min(tile.heightCm + tile.gutterCm, wall.heightCm / rows);
  const originX = -((cols - 1) * stepX) / 2;
  const originY = ((rows - 1) * stepY) / 2;

  const placements: Placement[] = [];
  buckets.forEach((bucket, col) => {
    bucket.forEach((cardId, row) => {
      placements.push({
        cardId,
        xCm: originX + col * stepX,
        yCm: originY - row * stepY,
        widthCm: tile.widthCm,
        heightCm: tile.heightCm,
        col,
        row,
      });
    });
  });

  return { placements, columnCosts };
}

// --- World placement ---------------------------------------------------
// Walls are world-anchored, not head-locked: the user walks around them.
// Lens Studio is right-handed with -Z forward, so a wall at yaw 0 sits at
// -Z, and its own yaw faces it back toward the user's start position.

export interface WallPlacement {
  positionCm: { x: number; y: number; z: number };
  /** Yaw about +Y, DEGREES. Convert to radians at the Lens Studio boundary. */
  yawDeg: number;
}

export function wallPlacement(
  wall: { distanceCm: number; yawDeg: number },
  eyeHeightCm: number,
  /**
   * Multiplies every wall's distance. 1 is the layout as designed for wearing;
   * above 1 pushes the whole room back so more of it fits in one frame —
   * which is what a recording needs, since the preview camera cannot be moved
   * back from the layout (the layout is placed relative to the camera, so it
   * simply follows). See Config.dev.layoutScale.
   */
  scale = 1,
): WallPlacement {
  const yawRad = (wall.yawDeg * Math.PI) / 180;
  const distance = wall.distanceCm * scale;
  return {
    positionCm: {
      x: Math.sin(yawRad) * distance,
      y: eyeHeightCm,
      z: -Math.cos(yawRad) * distance,
    },
    // NEGATED, and that is not a typo. A panel's front face is its local +Z, so
    // a panel rotated by its own bearing turns AWAY from the user — the further
    // round the arc it sits, the worse the angle. Turning back by the same
    // amount is what points it at the person standing in the middle.
    yawDeg: -wall.yawDeg,
  };
}
