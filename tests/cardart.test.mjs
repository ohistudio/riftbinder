import { test, assert, assertEqual } from './harness.mjs';
import { card } from './cards.mjs';
import { cardArtUrl, TILE_ART, FOCUS_ART, MAX_SOURCE_WIDTH } from './.build/CardArt.ts';

const RIOT_CDN = 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/abc-744x1039.png?accountingTag=RB';

test('art url appends transform params to an existing query string', () => {
  const c = card('001', 'Art Card', 'unit', ['Fury'], 3, { imageUrl: RIOT_CDN });
  const url = cardArtUrl(c, TILE_ART);
  assert(url.startsWith(RIOT_CDN), 'must preserve the original url and its params');
  assert(url.includes('&w=320'), url);
  assert(url.includes('&fm=jpg'), url);
  assertEqual(url.split('?').length, 2, 'must not introduce a second question mark');
});

test('art url starts a query string when the url has none', () => {
  const c = card('002', 'Bare', 'unit', ['Fury'], 1, { imageUrl: 'https://example.test/a.png' });
  assertEqual(cardArtUrl(c, TILE_ART), 'https://example.test/a.png?w=320&fm=jpg&q=80');
});

test('focus art is requested larger than tile art', () => {
  assert(FOCUS_ART.widthPx > TILE_ART.widthPx);
});

test('width is clamped to the source resolution, never upscaled', () => {
  const c = card('005', 'Big', 'unit', ['Fury'], 1, { imageUrl: 'https://example.test/a.png' });
  assertEqual(cardArtUrl(c, { widthPx: 4000, quality: 90 }),
    `https://example.test/a.png?w=${MAX_SOURCE_WIDTH}&fm=jpg&q=90`);
});

test('quality is optional and clamped to 1-100', () => {
  const c = card('006', 'Q', 'unit', ['Fury'], 1, { imageUrl: 'https://example.test/a.png' });
  assertEqual(cardArtUrl(c, { widthPx: 100 }), 'https://example.test/a.png?w=100&fm=jpg');
  assert(cardArtUrl(c, { widthPx: 100, quality: 999 }).endsWith('&q=100'));
});

test('a card with no art yields null rather than a broken url', () => {
  assertEqual(cardArtUrl(card('003', 'No Art', 'unit', ['Fury'], 1), TILE_ART), null);
  assertEqual(cardArtUrl(card('004', 'Blank', 'unit', ['Fury'], 1, { imageUrl: '   ' }), TILE_ART), null);
});

import { aspectOf, maxSourceWidth, LANDSCAPE_ASPECT, PORTRAIT_ASPECT } from './.build/CardArt.ts';

test('battlefields are landscape and everything else is portrait', () => {
  const unit = card('020', 'A Unit', 'unit', ['Fury'], 2);
  const field = card('021', 'A Field', 'battlefield', ['Colorless'], null);
  assertEqual(unit.orientation, 'portrait');
  assertEqual(field.orientation, 'landscape');
  assertEqual(aspectOf(unit), PORTRAIT_ASPECT);
  assertEqual(aspectOf(field), LANDSCAPE_ASPECT);
  assert(aspectOf(field) > 1 && aspectOf(unit) < 1, 'landscape is wider than tall');
});

test('a landscape card is not clamped to the portrait source width', () => {
  const field = card('022', 'Wide', 'battlefield', ['Colorless'], null,
    { imageUrl: 'https://example.test/a.png' });
  assertEqual(maxSourceWidth(field), 1039);
  assert(cardArtUrl(field, { widthPx: 4000 }).indexOf('w=1039') !== -1,
    'battlefields should reach their own native width');
});
