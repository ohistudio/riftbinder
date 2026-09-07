import { test, assert, assertEqual } from './harness.mjs';
import { CARDS } from './cards.mjs';
import {
  buildPricePrompt, parsePriceResponse, describePrice, describeCardForModel,
} from './.build/CardQuery.ts';

const CARD = CARDS.find((c) => c.name === 'Lantern Warden');

test('the card is given to the model, not recalled by it', () => {
  const described = describeCardForModel(CARD);
  assert(described.indexOf(CARD.name) !== -1);
  assert(described.indexOf(CARD.setCode) !== -1);
  assert(described.indexOf(String(CARD.energy)) !== -1, 'includes printed cost');
});

test('the price prompt demands a range and permits ignorance', () => {
  const prompt = buildPricePrompt(CARD);
  assert(prompt.indexOf('RANGE, never a single figure') !== -1);
  assert(prompt.indexOf('return nulls') !== -1, 'lets it say it does not know');
  assert(prompt.indexOf('Do not guess from the rarity alone') !== -1);
});

test('a price estimate is read back with its confidence', () => {
  const price = parsePriceResponse('{"low": 2, "high": 5.5, "currency":"USD","confidence":"medium","note":"reprinted"}');
  assertEqual(price.low, 2);
  assertEqual(price.high, 5.5);
  assertEqual(price.confidence, 'medium');
});

test('an unknown price stays unknown rather than becoming zero', () => {
  for (const reply of ['', 'no idea', '{"low":null,"high":null}', '{bad json']) {
    const price = parsePriceResponse(reply);
    assertEqual(price.low, null, `from ${reply}`);
    assertEqual(price.confidence, 'low');
  }
});

test('a backwards range is straightened, not shown as one', () => {
  const price = parsePriceResponse('{"low": 9, "high": 3, "confidence":"high"}');
  assertEqual(price.low, 3);
  assertEqual(price.high, 9);
});

test('nonsense numbers are refused', () => {
  const price = parsePriceResponse('{"low": -4, "high": "lots", "confidence":"high"}');
  assertEqual(price.low, null);
  assertEqual(price.high, null);
});

test('what is shown never reads as a quote', () => {
  const known = describePrice(CARD, parsePriceResponse(
    '{"low":2,"high":5,"currency":"USD","confidence":"high"}'));
  assert(known.indexOf('est.') !== -1, 'says it is an estimate');
  assert(known.indexOf('Not a quote') !== -1, 'says it is not a quote');

  const unknown = describePrice(CARD, parsePriceResponse('{}'));
  assert(unknown.indexOf('no price estimate') !== -1, `admits ignorance: ${unknown}`);
});
