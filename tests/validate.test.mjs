import { test, assert, assertEqual } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { MemoryCardSource } from './.build/MemoryCardSource.ts';
import { emptyDeck, addToDeck, setChosenChampion, fitsDomainIdentity, matchesLegendChampion,
         mainDeckSize, isSignatureCard, toSideboard } from './.build/DeckOps.ts';
import { validate, errorCount } from './.build/Validate.ts';
import { Rules, allRulesVerified } from './.build/Rules.ts';

const source = new MemoryCardSource(CARDS);
const byName = (n) => CARDS.find((c) => c.name === n);
const LEGEND = byName('Ashen Herald');        // legend, Fury + Chaos, tag Ashen
const CHAMPION = byName('Ashen Vanguard');    // unit, Fury, tag Ashen
const ON_DOMAIN = byName('Lantern Warden');   // Fury
const OFF_DOMAIN = byName('Mirefoot Scout');  // Calm
const DUAL = byName('Twinbound Rider');       // Fury + Calm
const COLOURLESS = byName('Grey Wanderer');   // Colorless
const rules = (v) => v.map((x) => x.rule);

function startedDeck() {
  let deck = addToDeck(emptyDeck('d', 'test', 1), LEGEND, 1, 2);
  return setChosenChampion(deck, CHAMPION, 3);
}

test('the construction numbers are verified, not placeholders', () => {
  assert(allRulesVerified(), 'core rules should now be verified against sources');
  assertEqual(Rules.mainMinimum.value, 40);
  assertEqual(Rules.maxCopies.value, 3);
  assertEqual(Rules.runeDeckSize.value, 12);
  assert(Rules.mainMinimum.verified && Rules.maxCopies.verified && Rules.runeDeckSize.verified);
});

test('a rule that is still unverified reports as a warning and says so', () => {
  // Battlefield count depends on the Mode of Play, so it stays unverified.
  assert(!Rules.battlefieldCount.verified);
  const hit = validate(startedDeck(), source).find((v) => v.rule === 'battlefields.count');
  assertEqual(hit.severity, 'warning');
  assert(hit.message.indexOf('unverified') !== -1);
});

test('a deck with no legend says so first — the legend is chosen first', () => {
  const v = validate(emptyDeck('d', 't', 1), source);
  const hit = v.find((x) => x.rule === 'legend.required');
  assert(hit !== undefined);
  assertEqual(hit.severity, 'error');
  assert(hit.message.toLowerCase().indexOf('identity') !== -1, 'should explain why it comes first');
});

test('a Chosen Champion is required and must share the legend\'s tag', () => {
  const noChampion = addToDeck(emptyDeck('d', 't', 1), LEGEND, 1, 2);
  assert(rules(validate(noChampion, source)).indexOf('champion.required') !== -1);

  const wrong = setChosenChampion(noChampion, ON_DOMAIN, 3);   // no Ashen tag
  const hit = validate(wrong, source).find((v) => v.rule === 'champion.tagMismatch');
  assert(hit !== undefined, 'a champion with the wrong tag must be rejected');

  assert(rules(validate(startedDeck(), source)).indexOf('champion.tagMismatch') === -1);
});

test('the Chosen Champion counts toward the 40 without sitting in the main deck', () => {
  const deck = startedDeck();
  assertEqual(deck.main.length, 0, 'the champion lives in the Champion Zone');
  assertEqual(mainDeckSize(deck), 1, 'but it still counts toward the total');
});

test('domain identity needs ALL of a card\'s domains inside the legend\'s', () => {
  assert(fitsDomainIdentity(ON_DOMAIN, LEGEND), 'Fury is inside Fury/Chaos');
  assert(!fitsDomainIdentity(OFF_DOMAIN, LEGEND), 'Calm is outside Fury/Chaos');
  // The important one: sharing ONE domain is not enough.
  assert(!fitsDomainIdentity(DUAL, LEGEND),
    'a Fury/Calm card must be rejected by a Fury/Chaos legend, despite sharing Fury');
  assert(fitsDomainIdentity(COLOURLESS, LEGEND), 'colourless fits any identity');
});

test('an off-identity card in the deck is an error, not a warning', () => {
  const deck = addToDeck(startedDeck(), DUAL, 1, 4);
  const hit = validate(deck, source).find((v) => v.rule === 'deck.domainIdentity');
  assert(hit !== undefined, 'dual-domain card should be flagged');
  assertEqual(hit.severity, 'error', 'this rule is verified, so it is an error');
  assert(hit.message.indexOf('BOTH') !== -1, 'should explain the dual-domain rule');
});

test('domain identity is checked in the rune deck too', () => {
  const rune = byName('Tidewalk Rune');        // Calm — outside Fury/Chaos
  const deck = addToDeck(startedDeck(), rune, 1, 4);
  assert(rules(validate(deck, source)).indexOf('deck.domainIdentity') !== -1);
});

test('exceeding three copies is flagged once per offending card', () => {
  const deck = addToDeck(startedDeck(), ON_DOMAIN, Rules.maxCopies.value + 1, 4);
  const hits = validate(deck, source).filter((v) => v.rule === 'main.maxCopies');
  assertEqual(hits.length, 1);
  assertEqual(hits[0].severity, 'error');
});

test('an undersized deck is an error; an oversized one is only unregisterable', () => {
  const small = validate(startedDeck(), source);
  const tooFew = small.find((v) => v.rule === 'main.minimumSize');
  assertEqual(tooFew.severity, 'error');

  // 41 cards: legal by the core rules, but not registerable for sanctioned play.
  let big = startedDeck();
  for (let i = 0; i < 14; i++) {
    const filler = { ...ON_DOMAIN, id: `tst-fill${i}-001`, name: `Filler ${i}` };
    big = addToDeck(big, filler, 3, 5);
  }
  assertEqual(mainDeckSize(big), 43);
  const over = validate(big, source);
  assert(over.every((v) => v.rule !== 'main.minimumSize'), 'a 43-card deck meets the minimum');
  const sanctioned = over.find((v) => v.rule === 'main.sanctionedSize');
  assertEqual(sanctioned.severity, 'warning', 'exact-40 is a sanctioned-play expectation, not a core rule');
});

test('battlefields must have unique names', () => {
  const field = byName('Quiet Harbour');
  const deck = { ...startedDeck(), battlefieldIds: [field.id, field.id] };
  const hit = validate(deck, source).find((v) => v.rule === 'battlefields.duplicateName');
  assert(hit !== undefined);
  assertEqual(hit.severity, 'error');
});

test('changing legend clears a Chosen Champion that no longer matches', () => {
  const other = { ...LEGEND, id: 'tst-099-001', name: 'Other Legend', tags: ['Other'] };
  const deck = addToDeck(startedDeck(), other, 1, 9);
  assertEqual(deck.chosenChampionId, null, 'the old champion no longer matches the new legend');
});

test('validation reports and never blocks', () => {
  // Every one of these is illegal, and every one is still allowed to happen.
  let deck = addToDeck(startedDeck(), OFF_DOMAIN, 9, 4);
  assert(errorCount(validate(deck, source)) > 0);
  assertEqual(deck.main[0].count, 9, 'the edit was recorded regardless');
});

test('matchesLegendChampion only accepts units', () => {
  assert(matchesLegendChampion(CHAMPION, LEGEND));
  assert(!matchesLegendChampion(LEGEND, LEGEND), 'a legend is not its own Chosen Champion');
  assert(!matchesLegendChampion(CHAMPION, null));
});

test('a partial sideboard is flagged; empty or eight is fine', () => {
  const card = byName('Lantern Warden');
  let deck = addToDeck(startedDeck(), card, 3, 4);

  assert(validate(deck, source).every((v) => v.rule !== 'sideboard.size'),
    'an empty sideboard is legal');

  const partial = { ...deck, sideboard: [{ cardId: card.id, count: 3 }] };
  const hit = validate(partial, source).find((v) => v.rule === 'sideboard.size');
  assert(hit !== undefined, 'three is neither 0 nor 8');
  // Community guidance rather than a numbered rule, so it stays a warning.
  assertEqual(hit.severity, 'warning');
  assert(hit.message.indexOf('unverified') !== -1);

  const full = { ...deck, sideboard: [{ cardId: card.id, count: 8 }] };
  assert(validate(full, source).every((v) => v.rule !== 'sideboard.size'));
});

test('sideboard cards obey the legend\'s domain identity', () => {
  const deck = { ...startedDeck(), sideboard: [{ cardId: OFF_DOMAIN.id, count: 8 }] };
  assert(rules(validate(deck, source)).indexOf('deck.domainIdentity') !== -1,
    'a sideboard card enters play, so it must fit the identity');
});

// --- Signature cards, 103.2.d ----------------------------------------------

const SIG_RITE  = byName('Ashen Rite');       // signature, tag Ashen
const SIG_BRAND = byName('Ashen Brand');      // signature, tag Ashen
const SIG_SHADE = byName('Ashen Shade');      // signature UNIT, tag Ashen
const SIG_OTHER = byName('Mirefoot Ambush');  // signature, tag Mirefoot

test('the signature supertype is what 103.2.d counts, not the printing flag', () => {
  // Riftcodex marks the '229*' LEGEND printing as metadata.signature. That is a
  // different set of cards and must never reach this rule.
  assert(isSignatureCard(SIG_RITE));
  assert(!isSignatureCard(CHAMPION), 'a Champion supertype is not a Signature one');
  assert(!isSignatureCard(ON_DOMAIN));
});

test('three signature cards is legal; a fourth is an error', () => {
  let deck = startedDeck();
  deck = addToDeck(deck, SIG_RITE, 3, 4);
  assertEqual(validate(deck, source).filter((v) => v.rule === 'main.signatureLimit').length, 0);

  deck = addToDeck(deck, SIG_BRAND, 1, 5);
  const hit = validate(deck, source).find((v) => v.rule === 'main.signatureLimit');
  assert(hit !== undefined, 'four signature cards should be reported');
  assertEqual(hit.severity, 'error');           // 103.2.d is verified
  assert(hit.message.indexOf('4') !== -1, 'should say how many were counted');
});

test('the limit counts cards, not distinct names', () => {
  // Three copies of ONE signature card already spends the whole allowance.
  let deck = addToDeck(startedDeck(), SIG_RITE, 3, 4);
  deck = addToDeck(deck, SIG_SHADE, 1, 5);
  assert(validate(deck, source).some((v) => v.rule === 'main.signatureLimit'));
});

test('a Chosen Champion that is a signature unit counts toward the three', () => {
  // Signature UNITS exist and can carry the legend's tag, so this is reachable.
  let deck = addToDeck(emptyDeck('d', 'test', 1), LEGEND, 1, 2);
  deck = setChosenChampion(deck, SIG_SHADE, 3);
  deck = addToDeck(deck, SIG_RITE, 3, 4);
  const hit = validate(deck, source).find((v) => v.rule === 'main.signatureLimit');
  assert(hit !== undefined, 'champion + 3 in the main deck is four signature cards');
  assert(hit.message.indexOf('4') !== -1);
});

test("another champion's signature card is a warning, not a verdict", () => {
  // Off-tag signature cards are very likely illegal, but 103.2.d does not say
  // so outright — so this reports as an unverified warning.
  const deck = addToDeck(startedDeck(), SIG_OTHER, 1, 4);
  const hit = validate(deck, source).find((v) => v.rule === 'main.signatureTag');
  assert(hit !== undefined);
  assertEqual(hit.severity, 'warning');
  assert(hit.message.indexOf('unverified') !== -1, 'must admit it is unverified');
  assert(hit.message.indexOf('Mirefoot') !== -1, 'should name whose card it is');
});

test('an on-tag signature card raises no tag warning', () => {
  const deck = addToDeck(startedDeck(), SIG_RITE, 1, 4);
  assertEqual(validate(deck, source).filter((v) => v.rule === 'main.signatureTag').length, 0);
});

test('the sideboard is outside the signature count', () => {
  // 103.2.d limits the deck as registered; a swap is a between-games change.
  let deck = addToDeck(startedDeck(), SIG_RITE, 3, 4);
  deck = toSideboard(addToDeck(deck, SIG_BRAND, 1, 5), SIG_BRAND, 6);
  assertEqual(validate(deck, source).filter((v) => v.rule === 'main.signatureLimit').length, 0);
});
