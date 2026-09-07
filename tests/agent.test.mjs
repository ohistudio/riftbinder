import { test, assert, assertEqual, assertDeep } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { selectCandidates, buildSuggestionPrompt, parseAgentResponse, extractJson, MAX_CANDIDATES }
  from './.build/AgentPrompt.ts';
import { emptyFilter, parseFilter } from './.build/Search.ts';
import { emptyDeck, addToDeck } from './.build/DeckOps.ts';

const byId = (id) => CARDS.find((c) => c.id === id) ?? null;
const byName = (n) => CARDS.find((c) => c.name === n);
const LEGEND = byName('Ashen Herald');        // legend, domains Fury + Chaos
const ids = (cards) => cards.map((c) => c.id);

test('candidates narrow to the legend\'s domains once a legend is chosen', () => {
  const deck = addToDeck(emptyDeck('d', 't', 1), LEGEND, 1, 2);
  const picked = selectCandidates(CARDS, deck, emptyFilter(), byId);
  assert(picked.length > 0);
  assert(picked.every((c) => c.domains.some((d) => d === 'Fury' || d === 'Chaos')),
    'off-domain card offered: ' + ids(picked).join(','));
});

test('the legend itself and chosen battlefields are never offered back', () => {
  const field = byName('Quiet Harbour');
  let deck = addToDeck(emptyDeck('d', 't', 1), LEGEND, 1, 2);
  deck = addToDeck(deck, field, 1, 3);
  const picked = ids(selectCandidates(CARDS, deck, emptyFilter(), byId));
  assert(picked.indexOf(LEGEND.id) === -1, 'legend offered as a suggestion');
  assert(picked.indexOf(field.id) === -1, 'already-chosen battlefield offered again');
});

test('candidate selection is deterministic and capped', () => {
  const deck = emptyDeck('d', 't', 1);
  const a = ids(selectCandidates(CARDS, deck, emptyFilter(), byId));
  const b = ids(selectCandidates(CARDS, deck, emptyFilter(), byId));
  assertDeep(a, b, 'same question must give the same candidates');
  assert(selectCandidates(CARDS, deck, emptyFilter(), byId, 3).length <= 3);
  // Kept small on purpose: each candidate carries its full rules text, and a
  // prompt of forty of them pushed the request onto the gateway's deadline.
  assert(MAX_CANDIDATES <= 20, 'a large candidate list makes the ask time out');
});

test('a filter from the request narrows the candidate pool', () => {
  const deck = emptyDeck('d', 't', 1);
  const filter = parseFilter('units under four', ['Fury', 'Chaos', 'Calm', 'Order', 'Mind']);
  const picked = selectCandidates(CARDS, deck, filter, byId);
  assert(picked.every((c) => c.type === 'unit' && c.energy !== null && c.energy <= 3));
});

test('the prompt contains the real candidate cards and forbids inventing others', () => {
  const deck = emptyDeck('d', 't', 1);
  const candidates = selectCandidates(CARDS, deck, emptyFilter(), byId, 5);
  const prompt = buildSuggestionPrompt('something cheap', candidates, deck, byId);
  for (const card of candidates) {
    assert(prompt.indexOf(card.id) !== -1, `candidate ${card.id} missing from prompt`);
    assert(prompt.indexOf(card.name) !== -1, `candidate name ${card.name} missing`);
  }
  assert(prompt.indexOf('ONLY cards from the CANDIDATES') !== -1, 'grounding rule missing');
  assert(prompt.toLowerCase().indexOf('win rate') !== -1, 'metagame prohibition missing');
});

// --- parsing --------------------------------------------------------

const ALLOWED = ['tst-001-001', 'tst-002-001', 'tst-003-001'];
const GOOD = '{"summary":"Cheap aggro.","picks":[{"id":"tst-001-001","reason":"Fills the one drop."}]}';

test('a clean reply parses', () => {
  const r = parseAgentResponse(GOOD, ALLOWED);
  assertEqual(r.summary, 'Cheap aggro.');
  assertEqual(r.picks.length, 1);
  assertEqual(r.picks[0].cardId, 'tst-001-001');
  assertDeep(r.rejected, []);
});

test('fenced JSON with prose either side still parses', () => {
  const raw = 'Sure! Here you go:\n```json\n' + GOOD + '\n```\nHope that helps.';
  assertEqual(parseAgentResponse(raw, ALLOWED).picks[0].cardId, 'tst-001-001');
});

test('a hallucinated card id is rejected, never displayed', () => {
  const raw = '{"summary":"x","picks":[{"id":"tst-001-001","reason":"real"},'
    + '{"id":"riftbound-imaginary-999","reason":"invented"}]}';
  const r = parseAgentResponse(raw, ALLOWED);
  assertEqual(r.picks.length, 1, 'invented card must not survive');
  assertEqual(r.picks[0].cardId, 'tst-001-001');
  assertDeep(r.rejected, ['riftbound-imaginary-999']);
});

test('a repeated pick counts once', () => {
  const raw = '{"summary":"x","picks":[{"id":"tst-002-001","reason":"a"},{"id":"tst-002-001","reason":"b"}]}';
  assertEqual(parseAgentResponse(raw, ALLOWED).picks.length, 1);
});

test('a truncated reply salvages the picks it did complete', () => {
  const raw = '{"summary":"Cheap aggro.","picks":[{"id":"tst-001-001","reason":"Fills the one drop."},{"id":"tst-00';
  const r = parseAgentResponse(raw, ALLOWED);
  assertEqual(r.picks.length, 1, 'the completed pick should survive truncation');
  assertEqual(r.picks[0].cardId, 'tst-001-001');
});

test('truncation mid-string does not throw', () => {
  const raw = '{"summary":"Cheap ag';
  const r = parseAgentResponse(raw, ALLOWED);
  assertEqual(r.picks.length, 0);
});

test('garbage and empty replies return an empty response rather than throwing', () => {
  for (const raw of ['', 'I cannot help with that.', 'null', '[]', '{']) {
    const r = parseAgentResponse(raw, ALLOWED);
    assertEqual(r.picks.length, 0, `raw: ${raw}`);
  }
});

test('a non-array picks field is ignored safely', () => {
  assertEqual(parseAgentResponse('{"summary":"x","picks":"nope"}', ALLOWED).picks.length, 0);
});

test('extractJson finds the object inside surrounding noise', () => {
  assertEqual(extractJson('blah {"a":1} blah'), '{"a":1}');
  assertEqual(extractJson('no json here'), null);
  assertEqual(extractJson('{"a":"}"}'), '{"a":"}"}', 'a brace inside a string must not close the object');
});

// --- build order: legend first ----------------------------------------

import { stageOf } from './.build/AgentPrompt.ts';
import { setChosenChampion, autoFillRunes } from './.build/DeckOps.ts';

const LEGEND_CARD = CARDS.find((c) => c.name === 'Ashen Herald');
const CHAMPION_CARD = CARDS.find((c) => c.name === 'Ashen Vanguard');

test('the build stage advances legend -> champion -> battlefields', () => {
  let deck = emptyDeck('d', 't', 1);
  assertEqual(stageOf(deck), 'legend');
  deck = addToDeck(deck, LEGEND_CARD, 1, 2);
  assertEqual(stageOf(deck), 'champion');
  deck = setChosenChampion(deck, CHAMPION_CARD, 3);
  assertEqual(stageOf(deck), 'battlefields');
});

test('with no legend, ONLY legends are offered', () => {
  const picked = selectCandidates(CARDS, emptyDeck('d', 't', 1), emptyFilter(), byId);
  assert(picked.length > 0);
  assert(picked.every((c) => c.type === 'legend'),
    'suggesting anything else is premature — legality depends on the legend');
});

test('with a legend but no champion, only matching champion units are offered', () => {
  const deck = addToDeck(emptyDeck('d', 't', 1), LEGEND_CARD, 1, 2);
  const picked = selectCandidates(CARDS, deck, emptyFilter(), byId);
  assert(picked.length > 0);
  assert(picked.every((c) => c.type === 'unit'));
  assert(picked.every((c) => c.tags.some((t) => LEGEND_CARD.tags.indexOf(t) !== -1)));
});

/** Walk past the gated stages so the open-ended deck stage can be tested. */
function readyToBuild() {
  let deck = addToDeck(emptyDeck('d', 't', 1), LEGEND_CARD, 1, 2);
  deck = setChosenChampion(deck, CHAMPION_CARD, 3);
  const field = CARDS.find((c) => c.type === 'battlefield');
  for (let i = 0; i < 3; i++) {
    deck = addToDeck(deck, { ...field, id: `bf-${i}`, name: `Field ${i}` }, 1, 4);
  }
  return autoFillRunes(deck, CARDS, byId, 5, 12);
}

test('once building, candidates obey domain identity strictly', () => {
  const deck = readyToBuild();
  const picked = selectCandidates(CARDS, deck, emptyFilter(), byId);

  assert(picked.every((c) => c.type !== 'legend'), 'a second legend is not a suggestion');
  // A Fury/Calm card shares Fury but is still illegal here.
  assert(!picked.some((c) => c.name === 'Twinbound Rider'),
    'a dual-domain card outside the identity must not be offered');
  assert(!picked.some((c) => c.name === 'Mirefoot Scout'), 'off-domain card offered');
});

test('the prompt tells the model which stage it is answering for', () => {
  const empty = emptyDeck('d', 't', 1);
  const legendPrompt = buildSuggestionPrompt('help', selectCandidates(CARDS, empty, emptyFilter(), byId), empty, byId);
  assert(legendPrompt.indexOf('LEGENDS only') !== -1, legendPrompt.slice(0, 300));

  const deck = readyToBuild();
  const deckPrompt = buildSuggestionPrompt('help', selectCandidates(CARDS, deck, emptyFilter(), byId), deck, byId);
  assert(deckPrompt.indexOf('domain identity') !== -1);
});

test('a type word in the request does not starve an earlier stage', () => {
  // "units" at the legend stage would otherwise intersect to nothing.
  const filter = parseFilter('suggest cheap aggressive units', ['Fury', 'Chaos', 'Calm']);
  const picked = selectCandidates(CARDS, emptyDeck('d', 't', 1), filter, byId);
  assert(picked.length > 0, 'the stage should win over the phrasing');
  assert(picked.every((c) => c.type === 'legend'));
});

test('the prompt resolves "this" to the card being looked at', () => {
  const deck = readyToBuild();
  const candidates = selectCandidates(CARDS, deck, emptyFilter(), byId, 5);
  const focus = CARDS.find((c) => c.name === 'Lantern Warden');

  const without = buildSuggestionPrompt('what pairs well with this', candidates, deck, byId);
  assert(without.indexOf('LOOKING AT') === -1, 'no focus, no claim about one');

  const withFocus = buildSuggestionPrompt('what pairs well with this', candidates, deck, byId, focus);
  assert(withFocus.indexOf('LOOKING AT') !== -1);
  assert(withFocus.indexOf(focus.name) !== -1, 'the focused card must be named');
});

test('the prompt forbids metagame answers explicitly, including recency', () => {
  const deck = readyToBuild();
  const prompt = buildSuggestionPrompt('what was played recently', selectCandidates(CARDS, deck, emptyFilter(), byId), deck, byId);
  const lower = prompt.toLowerCase();
  assert(lower.indexOf('no win rates') !== -1);
  assert(lower.indexOf('played recently') !== -1, 'recency is metagame data and must be refused');
  assert(lower.indexOf('never invent it') !== -1);
});
