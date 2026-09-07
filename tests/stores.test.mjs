import { test, assert, assertEqual } from './harness.mjs';
import { buildStorePrompt, parseStoreResponse } from './.build/StorePrompt.ts';

test('the prompt forbids inventing shops and addresses', () => {
  const prompt = buildStorePrompt(51.5074, -0.1278);
  // The whole safety of this feature rests on these instructions surviving.
  assert(prompt.includes('Do NOT invent shops.'));
  assert(prompt.includes('Do NOT invent street addresses'));
  assert(prompt.includes('return an empty list'));
  assert(prompt.includes('51.507'));
  assert(prompt.includes('-0.128'));
});

test('well-formed suggestions are read back', () => {
  const stores = parseStoreResponse(
    'Sure!\n{"stores":[{"name":"Dark Sphere","area":"Waterloo"},{"name":"Chaos Cards","area":"Hemel"}]}');
  assertEqual(stores.length, 2);
  assertEqual(stores[0].name, 'Dark Sphere');
  assertEqual(stores[1].area, 'Hemel');
});

test('an empty or unparseable answer yields nothing rather than junk', () => {
  assertEqual(parseStoreResponse('{"stores":[]}').length, 0);
  assertEqual(parseStoreResponse('I do not know of any.').length, 0);
  assertEqual(parseStoreResponse('{"stores": not json}').length, 0);
  assertEqual(parseStoreResponse('').length, 0);
});

test('entries without a usable name are dropped', () => {
  const stores = parseStoreResponse(
    '{"stores":[{"name":"","area":"X"},{"area":"Y"},{"name":"  ","area":"Z"},{"name":"Real Shop"}]}');
  assertEqual(stores.length, 1);
  assertEqual(stores[0].name, 'Real Shop');
  assertEqual(stores[0].area, '');
});
