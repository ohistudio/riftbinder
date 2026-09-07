import { test, assert, assertEqual, assertDeep } from './harness.mjs';
import { CARDS } from './cards.mjs';
import { applyFilter, emptyFilter, isEmptyFilter, parseFilter, describeFilter }
  from './.build/Search.ts';

const DOMAINS = ['Fury', 'Chaos', 'Order', 'Calm', 'Mind', 'Body', 'Colorless'];
const names = (cards) => cards.map((c) => c.name).sort();

test('an empty filter returns everything, untouched', () => {
  assert(isEmptyFilter(emptyFilter()));
  assertEqual(applyFilter(CARDS, emptyFilter()).length, CARDS.length);
});

test('type and domain clauses are AND-ed, values within a clause OR-ed', () => {
  const units = applyFilter(CARDS, { ...emptyFilter(), types: ['unit'] });
  assert(units.every((c) => c.type === 'unit'), 'type clause leaked');

  const furyOrCalm = applyFilter(CARDS, { ...emptyFilter(), domains: ['Fury', 'Calm'] });
  assert(furyOrCalm.every((c) => c.domains.some((d) => d === 'Fury' || d === 'Calm')));

  // Search is "has any of these domains" — deliberately looser than deck
  // legality, which requires ALL of a card's domains to fit the legend. A
  // Fury/Calm card should be findable when searching Calm.
  const both = applyFilter(CARDS, { ...emptyFilter(), types: ['unit'], domains: ['Calm'] });
  assertDeep(names(both), ['Mirefoot Scout', 'Twinbound Rider']);
});

test('a multi-domain card matches on either of its domains', () => {
  // Ashen Herald is ['Fury','Chaos'] — must appear under both.
  for (const domain of ['Fury', 'Chaos']) {
    const found = applyFilter(CARDS, { ...emptyFilter(), domains: [domain] });
    assert(found.some((c) => c.name === 'Ashen Herald'), `missing under ${domain}`);
  }
});

test('energy bounds exclude cards that have no energy at all', () => {
  // A legend has null energy. "under four" must not surface every legend.
  const cheap = applyFilter(CARDS, { ...emptyFilter(), energyMax: 3 });
  assert(cheap.every((c) => c.energy !== null), 'null-energy card leaked into an energy filter');
  assert(!cheap.some((c) => c.type === 'legend'), 'legend leaked into "under four"');
  assert(cheap.every((c) => c.energy <= 3));
});

test('"show me units under four" parses to the right predicate', () => {
  const filter = parseFilter('show me units under four', DOMAINS);
  assertDeep(filter.types, ['unit']);
  assertEqual(filter.energyMax, 3, 'under four means at most three');
  assertEqual(filter.energyMin, null);
  assertEqual(filter.text, null, 'structural words must not become a name query');
});

test('"only Calm" parses to a domain, case-insensitively', () => {
  const filter = parseFilter('only calm', DOMAINS);
  assertDeep(filter.domains, ['Calm']);
  assertEqual(filter.text, null);
});

test('domains come from the catalogue, not a hardcoded list', () => {
  const filter = parseFilter('only shurima', ['Shurima']);
  assertDeep(filter.domains, ['Shurima']);
  // The same word is just a name query when no such domain exists.
  assertDeep(parseFilter('only shurima', DOMAINS).domains, []);
});

test('"costs three" pins energy exactly; "over two" sets a floor', () => {
  const exact = parseFilter('costs three', DOMAINS);
  assertEqual(exact.energyMin, 3);
  assertEqual(exact.energyMax, 3);
  const floor = parseFilter('units over two', DOMAINS);
  assertEqual(floor.energyMin, 3);
  assertEqual(floor.energyMax, null);
});

test('leftover words become a fuzzy name query that survives noise', () => {
  const filter = parseFilter('find lantern warden', DOMAINS);
  assertEqual(filter.text, 'lantern warden');
  assertDeep(names(applyFilter(CARDS, filter)), ['Lantern Warden', 'Lantern Warden']);
  // One character of noise still matches.
  assert(applyFilter(CARDS, parseFilter('lantem warden', DOMAINS)).length > 0);
});

test('describeFilter is readable enough to show the user', () => {
  assertEqual(describeFilter(emptyFilter()), 'everything');
  assertEqual(describeFilter(parseFilter('show me units under four', DOMAINS)), 'unit, energy <= 3');
});
