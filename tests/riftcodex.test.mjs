import { test, assert, assertEqual, assertDeep } from './harness.mjs';
import { mapRiftcodexCard, mapRiftcodexPage, parseRiftboundId, parseCardType }
  from './.build/Riftcodex.ts';

// Captured verbatim from https://api.riftcodex.com/cards on 2026-09-01.
const SIGNATURE_LEGEND = {
  riftbound_id: 'unl-229*-219',
  name: 'Vi - Piltover Enforcer (Signature)',
  collector_number: 229,
  attributes: { energy: null, might: null, power: null },
  classification: { type: 'Legend', supertype: null, rarity: 'Rare', domain: ['Fury', 'Order'] },
  text: { plain: 'When you conquer, if you assigned 3 or more excess damage, you may exhaust me to ready a unit.', flavour: null },
  set: { set_id: 'UNL', label: 'Unleashed' },
  tags: ['Vi'],
};

const COMMON_UNIT = {
  riftbound_id: 'unl-121-219',
  name: 'Bewitching Spirit',
  collector_number: 121,
  attributes: { energy: 3, might: 2, power: null },
  classification: { type: 'Unit', supertype: null, rarity: 'Common', domain: ['Chaos'] },
  text: { plain: 'When you play me, choose a player. They discard 1.', flavour: 'Bandle Scout Rule 43.' },
  set: { set_id: 'UNL', label: 'Unleashed' },
  tags: ['Spirit', 'Shadow Isles'],
};

test('id parsing keeps the variant marker that identifies the printing', () => {
  assertDeep(parseRiftboundId('unl-121-219'), { setCode: 'UNL', collectorNumber: '121' });
  assertDeep(parseRiftboundId('unl-116a-219'), { setCode: 'UNL', collectorNumber: '116a' });
  assertDeep(parseRiftboundId('unl-229*-219'), { setCode: 'UNL', collectorNumber: '229*' });
  assertEqual(parseRiftboundId('nonsense'), null);
});

test('collector number comes from the id, not the numeric field', () => {
  // collector_number is 229; the id says '229*'. The star is the signature
  // printing, so dropping it would merge two distinct printings.
  const card = mapRiftcodexCard(SIGNATURE_LEGEND);
  assertEqual(card.collectorNumber, '229*');
  assert(card.collectorNumber !== String(SIGNATURE_LEGEND.collector_number));
});

test('card type is lower-cased, unknown types are rejected', () => {
  assertEqual(parseCardType('Unit'), 'unit');
  assertEqual(parseCardType('Battlefield'), 'battlefield');
  assertEqual(parseCardType('Sorcery'), null);
  assertEqual(parseCardType(null), null);
});

test('a multi-domain legend maps with every attribute null', () => {
  const card = mapRiftcodexCard(SIGNATURE_LEGEND);
  assertDeep(card.domains, ['Fury', 'Order']);
  assertEqual(card.energy, null);
  assertEqual(card.might, null);
  assertEqual(card.power, null);
  assertEqual(card.rarity, 'Rare');
  assertEqual(card.supertype, null);
  assertEqual(card.flavourText, null);
});

test('rules text and flavour text stay separate', () => {
  const card = mapRiftcodexCard(COMMON_UNIT);
  assertEqual(card.text, COMMON_UNIT.text.plain);
  assertEqual(card.flavourText, 'Bandle Scout Rule 43.');
  assert(card.text.indexOf('Bandle') === -1, 'flavour must not leak into rules text');
  assertEqual(card.energy, 3);
  assertEqual(card.might, 2);
  assertEqual(card.power, null);
});

test('unmappable rows are dropped rather than half-built', () => {
  assertEqual(mapRiftcodexCard({ ...COMMON_UNIT, riftbound_id: null }), null);
  assertEqual(mapRiftcodexCard({ ...COMMON_UNIT, name: '  ' }), null);
  assertEqual(mapRiftcodexCard({ ...COMMON_UNIT, classification: { type: 'Sorcery' } }), null);
  const page = mapRiftcodexPage([COMMON_UNIT, { name: 'junk' }, SIGNATURE_LEGEND]);
  assertEqual(page.length, 2);
});
