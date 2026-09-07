import { test, assert, assertEqual } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { emptyDeck, addToDeck } from './.build/DeckOps.ts';
import {
  emptyLibrary, saveDeck, removeDeck, findDeck,
  serialiseLibrary, parseLibrary, parseDeck, describeDeck,
} from './.build/DeckLibrary.ts';

const byId = (id) => CARDS.find((c) => c.id === id) ?? null;
const UNIT = CARDS.find((c) => c.name === 'Lantern Warden');
const LEGEND = CARDS.find((c) => c.name === 'Ashen Herald');

const make = (id, name) => {
  let deck = emptyDeck(id, name, 1);
  deck = addToDeck(deck, LEGEND, 1, 2);
  deck = addToDeck(deck, UNIT, 3, 3);
  return deck;
};

test('a saved deck survives a round trip through storage', () => {
  const library = saveDeck(emptyLibrary(), make('a', 'Aggro'), 100);
  const back = parseLibrary(serialiseLibrary(library));
  assertEqual(back.decks.length, 1);
  assertEqual(back.decks[0].name, 'Aggro');
  assertEqual(back.decks[0].main[0].count, 3);
  assertEqual(back.decks[0].legendId, LEGEND.id);
});

test('saving the same deck twice replaces it rather than duplicating', () => {
  let library = saveDeck(emptyLibrary(), make('a', 'Aggro'), 100);
  library = saveDeck(library, make('a', 'Aggro v2'), 200);
  assertEqual(library.decks.length, 1);
  assertEqual(library.decks[0].name, 'Aggro v2');
});

test('decks with the same NAME are kept apart', () => {
  // Matching on name would silently destroy one of them.
  let library = saveDeck(emptyLibrary(), make('a', 'Aggro'), 100);
  library = saveDeck(library, make('b', 'Aggro'), 200);
  assertEqual(library.decks.length, 2);
});

test('the shelf lists the most recently saved deck first', () => {
  let library = saveDeck(emptyLibrary(), make('a', 'Old'), 100);
  library = saveDeck(library, make('b', 'New'), 200);
  const back = parseLibrary(serialiseLibrary(library));
  assertEqual(back.decks[0].name, 'New');
});

test('corrupt storage yields an empty shelf, never a crash', () => {
  // A stored blob outlives the code that wrote it.
  assertEqual(parseLibrary('').decks.length, 0);
  assertEqual(parseLibrary('not json').decks.length, 0);
  assertEqual(parseLibrary('{"decks":"nope"}').decks.length, 0);
  assertEqual(parseLibrary('{"decks":[{"no":"id"}]}').decks.length, 0);
  assertEqual(parseDeck(null), null);
});

test('half-written slots are dropped, not loaded as nonsense', () => {
  const deck = parseDeck({
    id: 'x', name: 'Broken',
    main: [{ cardId: 'ok', count: 2 }, { cardId: '', count: 3 }, { count: 1 }, { cardId: 'z', count: 0 }],
    runes: null, battlefieldIds: ['a', 5, ''], sideboard: undefined,
  });
  assertEqual(deck.main.length, 1);
  assertEqual(deck.runes.length, 0);
  assertEqual(deck.battlefieldIds.length, 1);
});

test('removing and finding work by id', () => {
  let library = saveDeck(emptyLibrary(), make('a', 'Aggro'), 100);
  library = saveDeck(library, make('b', 'Control'), 200);
  assertEqual(findDeck(library, 'a').name, 'Aggro');
  library = removeDeck(library, 'a');
  assertEqual(findDeck(library, 'a'), null);
  assertEqual(library.decks.length, 1);
});

test('the shelf description says what the deck is without opening it', () => {
  const text = describeDeck(make('a', 'Aggro'), byId);
  assert(text.indexOf(LEGEND.name) !== -1, 'names the legend');
  assert(text.indexOf('3 main') !== -1, `counts the main deck: ${text}`);
});
