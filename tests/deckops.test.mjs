import { test, assert, assertEqual, assertDeep } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { emptyDeck, addToDeck, removeFromDeck, deckCount, mainDeckSize, runeDeckSize, energyCurve,
  toggleSideboard, sideboardSize }
  from './.build/DeckOps.ts';

const byName = (name) => CARDS.find((c) => c.name === name);
const UNIT = byName('Lantern Warden');       // unit, energy 3
const CHEAP = byName('Mirefoot Scout');      // unit, energy 1
const LEGEND = byName('Ashen Herald');       // legend
const RUNE = byName('Tidewalk Rune');        // rune
const FIELD = byName('Quiet Harbour');       // battlefield
const byId = (id) => CARDS.find((c) => c.id === id) ?? null;

test('adding routes by card type without being told the zone', () => {
  let deck = emptyDeck('d', 'test', 1);
  deck = addToDeck(deck, UNIT, 2, 2);
  deck = addToDeck(deck, LEGEND, 1, 3);
  deck = addToDeck(deck, RUNE, 4, 4);
  deck = addToDeck(deck, FIELD, 1, 5);

  assertEqual(deck.legendId, LEGEND.id);
  assertEqual(mainDeckSize(deck), 2);
  assertEqual(runeDeckSize(deck), 4);
  assertDeep(deck.battlefieldIds, [FIELD.id]);
  assertEqual(deck.main.length, 1, 'unit must not land in main twice');
});

test('a second legend replaces the first — there is only one', () => {
  const other = { ...LEGEND, id: 'tst-999-001', name: 'Other Legend' };
  let deck = addToDeck(emptyDeck('d', 't', 1), LEGEND, 1, 2);
  deck = addToDeck(deck, other, 1, 3);
  assertEqual(deck.legendId, other.id);
});

test('a battlefield is not duplicated', () => {
  let deck = addToDeck(emptyDeck('d', 't', 1), FIELD, 1, 2);
  deck = addToDeck(deck, FIELD, 1, 3);
  assertEqual(deck.battlefieldIds.length, 1);
});

test('repeat adds increment rather than creating a second slot', () => {
  let deck = addToDeck(emptyDeck('d', 't', 1), UNIT, 1, 2);
  deck = addToDeck(deck, UNIT, 3, 3);
  assertEqual(deck.main.length, 1);
  assertEqual(deckCount(deck, UNIT.id), 4);
});

test('removing decrements, drops the slot at zero, and no-ops when absent', () => {
  let deck = addToDeck(emptyDeck('d', 't', 1), UNIT, 2, 2);
  deck = removeFromDeck(deck, UNIT, 1, 3);
  assertEqual(deckCount(deck, UNIT.id), 1);
  deck = removeFromDeck(deck, UNIT, 5, 4);
  assertEqual(deck.main.length, 0);
  assertEqual(removeFromDeck(deck, UNIT, 1, 5).main.length, 0);
});

test('deck operations never mutate the deck handed to them', () => {
  const deck = addToDeck(emptyDeck('d', 't', 1), UNIT, 2, 2);
  const snapshot = JSON.stringify(deck);
  addToDeck(deck, CHEAP, 1, 3);
  removeFromDeck(deck, UNIT, 1, 4);
  addToDeck(deck, LEGEND, 1, 5);
  assertEqual(JSON.stringify(deck), snapshot);
});

test('updatedAt moves only when the deck actually changed', () => {
  const deck = addToDeck(emptyDeck('d', 't', 1), FIELD, 1, 10);
  assertEqual(deck.updatedAt, 10);
  assertEqual(addToDeck(deck, FIELD, 1, 99).updatedAt, 10, 'a no-op must not bump updatedAt');
  assertEqual(addToDeck(deck, UNIT, 1, 99).updatedAt, 99);
});

test('energy curve counts copies and puts null-energy cards last', () => {
  let deck = emptyDeck('d', 't', 1);
  deck = addToDeck(deck, CHEAP, 3, 2);   // energy 1
  deck = addToDeck(deck, UNIT, 2, 3);    // energy 3
  assertDeep(energyCurve(deck, byId), [{ energy: 1, count: 3 }, { energy: 3, count: 2 }]);
});

// --- cycling counts ----------------------------------------------------

import { cycleCard, maxCopiesFor } from './.build/DeckOps.ts';
import { setChosenChampion } from './.build/DeckOps.ts';

const LEGEND2 = byName('Ashen Herald');
const CHAMPION2 = byName('Ashen Vanguard');
const FURY_RUNE = byName('Fury Rune');
const lookup = (id) => CARDS.find((c) => c.id === id) ?? null;

function started() {
  let deck = addToDeck(emptyDeck('d', 't', 1), LEGEND2, 1, 2);
  return setChosenChampion(deck, CHAMPION2, 3);
}

test('a rune can climb past one copy — a toggle could never build a rune deck', () => {
  let deck = started();
  for (let i = 1; i <= 6; i++) {
    deck = cycleCard(deck, FURY_RUNE, lookup, 10, 12);
    assertEqual(deckCount(deck, FURY_RUNE.id), i, `expected ${i} copies`);
  }
});

test('runes are capped by what the rune deck still needs', () => {
  let deck = started();
  assertEqual(maxCopiesFor(FURY_RUNE, deck, lookup, 12), 12);
  // Six of another rune leaves room for six more.
  deck = addToDeck(deck, byName('Chaos Rune'), 6, 4);
  assertEqual(maxCopiesFor(FURY_RUNE, deck, lookup, 12), 6);
});

test('pinching at the maximum clears the card', () => {
  let deck = started();
  for (let i = 0; i < 3; i++) deck = cycleCard(deck, UNIT, lookup, 10, 3);
  assertEqual(deckCount(deck, UNIT.id), 3, 'main deck limit is three');
  deck = cycleCard(deck, UNIT, lookup, 10, 3);
  assertEqual(deckCount(deck, UNIT.id), 0, 'the next pinch wraps to none');
});

test('singletons still behave as a plain toggle', () => {
  const field = byName('Quiet Harbour');
  let deck = started();
  assertEqual(maxCopiesFor(field, deck, lookup), 1);
  deck = cycleCard(deck, field, lookup, 12, 3);
  assertEqual(deck.battlefieldIds.length, 1);
  deck = cycleCard(deck, field, lookup, 12, 3);
  assertEqual(deck.battlefieldIds.length, 0, 'a second pinch removes it');
});

test('a matching champion unit is a singleton and lands in the Champion Zone', () => {
  let deck = addToDeck(emptyDeck('d', 't', 1), LEGEND2, 1, 2);
  assertEqual(maxCopiesFor(CHAMPION2, deck, lookup), 1);
  deck = cycleCard(deck, CHAMPION2, lookup, 12, 3);
  assertEqual(deck.chosenChampionId, CHAMPION2.id);
  assertEqual(deck.main.length, 0, 'it belongs in the Champion Zone, not the main deck');
});

test('a card moves to the sideboard and back with one control', () => {
  // One toggle, not two buttons: a card is only ever in one of the two places,
  // so which direction is meant is never ambiguous.
  let deck = emptyDeck('d', 'test', 1);
  deck = addToDeck(deck, UNIT, 2, 2);
  assertEqual(deckCount(deck, UNIT.id), 2);

  deck = toggleSideboard(deck, UNIT, 3);
  assertEqual(sideboardSize(deck), 1);
  assertEqual(deckCount(deck, UNIT.id), 1);

  deck = toggleSideboard(deck, UNIT, 4);
  assertEqual(sideboardSize(deck), 0);
  assertEqual(deckCount(deck, UNIT.id), 2);
});

test('toggling a card that is in neither place changes nothing', () => {
  const deck = emptyDeck('d', 'test', 1);
  assertEqual(toggleSideboard(deck, UNIT, 2), deck);
});
