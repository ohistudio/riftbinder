import { test, assert, assertEqual, assertDeep } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { MemoryCardSource } from './.build/MemoryCardSource.ts';
import { emptyDeck, addToDeck } from './.build/DeckOps.ts';
import { exportDecklist, importDecklist, buildPullList, formatPullList, compareCollectorNumbers }
  from './.build/Export.ts';

const source = new MemoryCardSource(CARDS);
const byName = (n) => CARDS.find((c) => c.name === n);

function sampleDeck() {
  let deck = emptyDeck('d1', 'Test Deck', 100);
  deck = addToDeck(deck, byName('Ashen Herald'), 1, 101);    // legend
  deck = addToDeck(deck, byName('Lantern Warden'), 3, 102);  // main
  deck = addToDeck(deck, byName('Emberfall Rite'), 2, 103);  // main
  deck = addToDeck(deck, byName('Tidewalk Rune'), 4, 104);   // runes
  deck = addToDeck(deck, byName('Quiet Harbour'), 1, 105);   // battlefield
  return deck;
}

test('a decklist round-trips to an identical deck', () => {
  const deck = sampleDeck();
  const text = exportDecklist(deck, source);
  const back = importDecklist(text, deck.id, deck.updatedAt);

  assertEqual(back.legendId, deck.legendId);
  assertDeep(back.main, deck.main);
  assertDeep(back.runes, deck.runes);
  assertDeep(back.battlefieldIds, deck.battlefieldIds);
  assertEqual(back.name, deck.name);
});

test('the list carries printing ids, so variants do not collapse', () => {
  // tst-001-001 and tst-001a-001 are different printings of the same card name.
  let deck = emptyDeck('d', 't', 1);
  deck = addToDeck(deck, CARDS.find((c) => c.id === 'tst-001-001'), 1, 2);
  deck = addToDeck(deck, CARDS.find((c) => c.id === 'tst-001a-001'), 1, 3);
  const back = importDecklist(exportDecklist(deck, source), 'd', 1);
  assertEqual(back.main.length, 2, 'two printings must not merge into one line');
  assertDeep(back.main.map((s) => s.cardId).sort(), ['tst-001-001', 'tst-001a-001']);
});

test('import ignores the trailing name, so a renamed card still imports', () => {
  const text = '# Deck\n# Legend\n# Main\n3 tst-001-001 Some Totally Different Name\n# Runes\n# Battlefields';
  const deck = importDecklist(text, 'd', 1);
  assertDeep(deck.main, [{ cardId: 'tst-001-001', count: 3 }]);
});

test('import survives blank lines and junk rows', () => {
  const text = '# Deck\n\n# Legend\n\n# Main\nnot a card line\n0 tst-002-001 zero count\n2 tst-001-001 Fine\n';
  const deck = importDecklist(text, 'd', 1);
  assertDeep(deck.main, [{ cardId: 'tst-001-001', count: 2 }]);
});

test('collector numbers sort numerically, not lexicographically', () => {
  const sorted = ['10', '7', '116a', '116', '2'].sort(compareCollectorNumbers);
  assertDeep(sorted, ['2', '7', '10', '116', '116a']);
});

test('the pull list is grouped by set and ascending within it', () => {
  const deck = sampleDeck();
  const entries = buildPullList(deck, source);
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (prev.setCode === cur.setCode) {
      assert(compareCollectorNumbers(prev.collectorNumber, cur.collectorNumber) <= 0,
        `${prev.collectorNumber} came before ${cur.collectorNumber}`);
    } else {
      assert(prev.setCode < cur.setCode, 'sets out of order');
    }
  }
});

test('the pull list counts every copy across every zone', () => {
  const entries = buildPullList(sampleDeck(), source);
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  assertEqual(total, 1 + 3 + 2 + 4 + 1, 'legend, main, runes and battlefields must all be counted');
  assertEqual(entries.find((e) => e.name === 'Lantern Warden').count, 3);
});

test('the formatted pull list has a heading per set', () => {
  const text = formatPullList(buildPullList(sampleDeck(), source));
  assert(text.indexOf('## TST') !== -1, text);
});

// --- sideboard ---------------------------------------------------------

import { toSideboard, fromSideboard, sideboardSize } from './.build/DeckOps.ts';

test('a deck with a sideboard round-trips', () => {
  let deck = sampleDeck();
  deck = toSideboard(deck, byName('Lantern Warden'), 200);
  assertEqual(sideboardSize(deck), 1);

  const back = importDecklist(exportDecklist(deck, source), deck.id, deck.updatedAt);
  assertDeep(back.sideboard, deck.sideboard);
  assertDeep(back.main, deck.main);
});

test('moving to the sideboard takes the card out of the main deck', () => {
  const card = byName('Lantern Warden');
  let deck = sampleDeck();
  const before = deck.main.find((s) => s.cardId === card.id).count;
  deck = toSideboard(deck, card, 200);
  const after = deck.main.find((s) => s.cardId === card.id);
  assertEqual(after === undefined ? 0 : after.count, before - 1, 'main should lose a copy');
  assertEqual(sideboardSize(deck), 1);
});

test('moving back returns it to the main deck', () => {
  const card = byName('Lantern Warden');
  let deck = toSideboard(sampleDeck(), card, 200);
  deck = fromSideboard(deck, card, 300);
  assertEqual(sideboardSize(deck), 0);
  assertEqual(deck.main.find((s) => s.cardId === card.id).count, 3);
});

test('moving a card that is not there is a no-op', () => {
  const stranger = byName('Grey Wanderer');
  const deck = sampleDeck();
  assertEqual(toSideboard(deck, stranger, 200), deck);
  assertEqual(fromSideboard(deck, stranger, 200), deck);
});

test('the pull list counts sideboard copies too', () => {
  const card = byName('Lantern Warden');
  const deck = toSideboard(sampleDeck(), card, 200);
  const entry = buildPullList(deck, source).find((e) => e.name === card.name);
  assertEqual(entry.count, 3, 'two in main plus one in the sideboard is still three to find');
});
