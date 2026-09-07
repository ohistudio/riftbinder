import { test, assert, assertEqual } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { emptyDeck, addToDeck } from './.build/DeckOps.ts';
import { serialiseDeck, parseDeckWire, encodeIntent, decodeIntent, isShareable,
         newerDeck, EDIT_MAX_WIRE_BYTES } from './.build/DeckWire.ts';

const byName = (n) => CARDS.find((c) => c.name === n);
const LEGEND = byName('Ashen Herald');
const CARD = byName('Lantern Warden');

function aDeck() {
  return addToDeck(addToDeck(emptyDeck('d1', 'Aggro', 1), LEGEND, 1, 2), CARD, 3, 3);
}

test('a deck survives the round trip intact', () => {
  const deck = aDeck();
  const back = parseDeckWire(serialiseDeck(deck));
  assertEqual(back.id, deck.id);
  assertEqual(back.name, deck.name);
  assertEqual(back.legendId, deck.legendId);
  assertEqual(back.main.length, deck.main.length);
  assertEqual(back.main[0].count, deck.main[0].count);
  assertEqual(back.updatedAt, deck.updatedAt);
});

test('junk on the wire yields null, never a throw', () => {
  for (const bad of ['', 'not json', '{', 'null', '[]', '{"no":"id"}', '3']) {
    assertEqual(parseDeckWire(bad), null, `should reject ${bad}`);
  }
});

test('only deck edits are allowed to cross', () => {
  assert(isShareable({ kind: 'ADD', cardId: 'x', count: 1 }));
  assert(isShareable({ kind: 'CLEAR' }));
  // The ones that must never travel, each for its own reason.
  assert(!isShareable({ kind: 'ASK', prompt: 'hi' }), 'ASK spends Gemini quota');
  assert(!isShareable({ kind: 'PRICE_CARD', cardId: 'x' }), 'PRICE_CARD spends quota');
  assert(!isShareable({ kind: 'SCAN', cannedImageId: null }), 'SCAN opens your camera');
  assert(!isShareable({ kind: 'EXPORT' }), 'EXPORT writes your storage');
  assert(!isShareable({ kind: 'FOCUS', cardId: 'x' }), 'your eyes, not theirs');
  assert(!isShareable({ kind: 'SCROLL', rows: 1 }), 'a shared cursor is a fight');
});

test('an unshareable intent encodes to null rather than being sent', () => {
  assertEqual(encodeIntent({ kind: 'ASK', prompt: 'anything' }), null);
  assert(encodeIntent({ kind: 'ADD', cardId: 'tst-001-001', count: 2 }) !== null);
});

test('a decoded edit is the same edit', () => {
  const intent = { kind: 'ADD', cardId: 'tst-001-001', count: 2 };
  const back = decodeIntent(encodeIntent(intent));
  assertEqual(back.kind, 'ADD');
  assertEqual(back.cardId, 'tst-001-001');
  assertEqual(back.count, 2);
});

test('a peer cannot smuggle in an intent that spends money', () => {
  // The decoder is what faces somebody else's bytes, so the guard lives there
  // too — not only on the encode side we control.
  assertEqual(decodeIntent(JSON.stringify({ kind: 'ASK', prompt: 'drain it' })), null);
  assertEqual(decodeIntent(JSON.stringify({ kind: 'PRICE_CARD', cardId: 'x' })), null);
  assertEqual(decodeIntent(JSON.stringify({ kind: 'SCAN', cannedImageId: null })), null);
});

test('a malformed payload is refused rather than half-trusted', () => {
  assertEqual(decodeIntent(''), null);
  assertEqual(decodeIntent('{oh no'), null);
  assertEqual(decodeIntent(JSON.stringify({ noKind: 1 })), null);
  assertEqual(decodeIntent(JSON.stringify({ kind: 'ADD', cardId: 7 })), null);
  // A NaN count would poison every later sum on that slot.
  assertEqual(decodeIntent('{"kind":"ADD","cardId":"x","count":null}'), null);
  assertEqual(decodeIntent(JSON.stringify({ kind: 'ADD', cardId: 'x', count: -3 })), null);
});

test('an edit too large for sendEvent is refused, not silently dropped', () => {
  // sendEvent discards oversized messages without erroring, so the refusal has
  // to happen here where the caller can see it.
  const huge = { kind: 'SEARCH', query: 'x'.repeat(EDIT_MAX_WIRE_BYTES * 2) };
  assertEqual(encodeIntent(huge), null);
  const longId = { kind: 'ADD', cardId: 'x'.repeat(EDIT_MAX_WIRE_BYTES), count: 1 };
  assertEqual(encodeIntent(longId), null);
});

test('multi-byte characters are measured in bytes, not characters', () => {
  // A deck named in emoji is 4 bytes a glyph; counting characters would let an
  // oversized message through to be dropped in silence.
  const emoji = { kind: 'SELECT', cardId: '🂡'.repeat(300) };
  assertEqual(encodeIntent(emoji), null);
});

test('the newer deck wins, and a tie keeps the one already held', () => {
  const held = { ...aDeck(), updatedAt: 100 };
  const older = { ...aDeck(), updatedAt: 50 };
  const newer = { ...aDeck(), updatedAt: 150 };
  assertEqual(newerDeck(held, older).updatedAt, 100);
  assertEqual(newerDeck(held, newer).updatedAt, 150);
  assert(newerDeck(held, { ...held }) === held, 'a tie should not replace');
});
