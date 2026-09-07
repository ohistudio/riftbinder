import { test, assert, assertEqual } from './harness.mjs';
import { prefixScore, rankByName, matchTranscription } from './.build/Matching.ts';

const OPTS = { autoAcceptThreshold: 0.82, maxAlternatives: 3, minAlternativeScore: 0.35 };

const card = (id, name, setCode, collectorNumber) => ({
  id, name, setCode, collectorNumber,
  type: 'unit', supertype: 'Champion', rarity: 'Rare', domains: ['Fury'],
  energy: 3, might: 3, power: 1, text: '', flavourText: '',
  imageUrl: '', artist: '', orientation: 'portrait',
});

const POUNCING = card('sfd-025-221', 'Rengar - Pouncing', 'SFD', '025');
const TROPHY = card('unl-120-219', 'Rengar - Trophy Hunter', 'UNL', '120');
const OTHER = card('ogn-025-298', 'Grand Duelist', 'OGN', '025');
const source = (cards) => ({ all: () => cards, byId: (id) => cards.find((c) => c.id === id) ?? null });

test('a title-only read matches the card it opens', () => {
  // The real failure: vision reads "Rengar" off the card, the catalogue stores
  // "Rengar - Pouncing", edit distance scores 0.4 and it was rejected.
  assertEqual(prefixScore('rengar', 'rengar pouncing'), 0.9);
  assertEqual(prefixScore('rengar', 'rengar'), 1);
});

test('a prefix must land on a word boundary', () => {
  assertEqual(prefixScore('reng', 'rengar pouncing'), 0);
  assertEqual(prefixScore('', 'rengar'), 0);
  assertEqual(prefixScore('rengar', ''), 0);
});

test('the collector number picks the right printing from a title-only read', () => {
  const result = matchTranscription(
    { name: 'Rengar', collectorNumber: '25', setCode: null },
    source([POUNCING, TROPHY, OTHER]), OPTS);
  assertEqual(result.matched, 'sfd-025-221');
});

test('an ambiguous title is offered, never guessed', () => {
  // Both Rengars open with the same word; auto-accepting either would put a
  // printing the user never held into their deck.
  const result = matchTranscription(
    { name: 'Rengar', collectorNumber: null, setCode: null },
    source([POUNCING, TROPHY]), OPTS);
  assertEqual(result.matched, null);
  assert(result.alternatives.length >= 2, 'both printings should be offered');
});

test('ranking still prefers the closer full name', () => {
  const ranked = rankByName([POUNCING, TROPHY], 'Rengar - Trophy Hunter', 3);
  assertEqual(ranked[0].card.id, 'unl-120-219');
});
