// Binder — snapshot the Riftbound catalogue into a local TypeScript module.
//
// NOTE the output filename has no second dot. Lens Studio's runtime module
// resolver strips everything after the first '.', so 'Catalogue.generated.ts'
// compiles cleanly and then fails at runtime with "Cannot find module".
//
// Run:  node tools/fetch-cards.mjs
//
// Fetching 30 paginated requests on every Lens start would be poor on a
// headset, so the catalogue is snapshotted here at author time and read locally
// at runtime. Re-run when a set releases. Mapping is done by the pure
// Core/Riftcodex.ts module so the snapshot and any future live fetch cannot
// diverge.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCore } from '../tests/build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'Assets', 'Scripts', 'Binder', 'Data', 'CatalogueGenerated.ts');
const API = 'https://api.riftcodex.com/cards';

const outDir = buildCore();
const { mapRiftcodexPage } = await import(pathToFileURL(join(outDir, 'Riftcodex.ts')).href);

async function getPage(page) {
  const res = await fetch(`${API}?page=${page}`);
  if (!res.ok) throw new Error(`page ${page}: HTTP ${res.status}`);
  return res.json();
}

const first = await getPage(1);
const pages = first.pages ?? 1;
process.stdout.write(`total=${first.total} pages=${pages}\n`);

let raw = first.items.slice();
for (let p = 2; p <= pages; p++) {
  const body = await getPage(p);
  raw = raw.concat(body.items);
  process.stdout.write(`\r  fetched page ${p}/${pages}`);
}
process.stdout.write('\n');

const cards = mapRiftcodexPage(raw);
const dropped = raw.length - cards.length;

// Stable order so a re-run produces a minimal diff rather than a reshuffle.
cards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const header = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Snapshot of the Riftbound catalogue, produced by tools/fetch-cards.mjs.
// Source: ${API} (Riftcodex, a community project not affiliated with Riot Games).
// Fetched: ${new Date().toISOString()}
// Cards:   ${cards.length}${dropped > 0 ? ` (${dropped} rows dropped as unmappable)` : ''}
//
// Card art is NOT snapshotted here. See BINDER.md for the licensing position on
// this data and what has to change before an App-specific Riot API key.

import type { Card } from '../Core/Types';

export const CATALOGUE_FETCHED_AT = '${new Date().toISOString()}';
export const CATALOGUE_SOURCE = 'riftcodex';

export const CATALOGUE_CARDS: Card[] = `;

writeFileSync(OUT, header + JSON.stringify(cards, null, 0) + ';\n');
process.stdout.write(`wrote ${OUT}\n  cards=${cards.length} dropped=${dropped}\n`);
