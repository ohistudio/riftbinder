// Synthetic test cards in the real Riftbound shape. Names are INVENTED — these
// are not Riftbound cards and exist only to exercise matching and layout.
// Ids follow the real three-segment form so variant markers get exercised.

export const card = (collectorNumber, name, type, domains, energy, opts = {}) => ({
  id: `tst-${collectorNumber}-001`,
  name,
  setCode: 'TST',
  collectorNumber,
  type,
  supertype: opts.supertype ?? null,
  rarity: opts.rarity ?? 'Common',
  domains,
  energy,
  might: opts.might ?? null,
  power: opts.power ?? null,
  text: opts.text ?? '',
  flavourText: opts.flavourText ?? null,
  tags: opts.tags ?? [],
  imageUrl: opts.imageUrl ?? null,
  artist: opts.artist ?? null,
  orientation: type === 'battlefield' ? 'landscape' : 'portrait',
});

export const CARDS = [
  card('001', 'Lantern Warden',  'unit',        ['Fury'],          3, { might: 2 }),
  card('002', 'Emberfall Rite',  'spell',       ['Chaos'],         2),
  card('003', 'Glass Sentinel',  'unit',        ['Order'],         5, { might: 4 }),
  card('004', 'Quiet Harbour',   'battlefield', ['Colorless'],  null),
  card('005', 'Ashen Herald',    'legend',      ['Fury', 'Chaos'], null, { supertype: 'Champion', tags: ['Ashen'] }),
  // A champion unit whose tag matches the legend — a legal Chosen Champion.
  card('010', 'Ashen Vanguard',  'unit',        ['Fury'],          2, { might: 2, tags: ['Ashen'] }),
  // Dual-domain: legal only if BOTH domains are inside the legend's identity.
  card('011', 'Twinbound Rider', 'unit',        ['Fury', 'Calm'],  3, { might: 3 }),
  card('012', 'Grey Wanderer',   'unit',        ['Colorless'],     2, { might: 1 }),
  // Runes matching the test legend's identity, so auto-fill has something to place.
  card('013', 'Fury Rune',       'rune',        ['Fury'],       null),
  card('014', 'Chaos Rune',      'rune',        ['Chaos'],      null),
  card('006', 'Tidewalk Rune',   'rune',        ['Calm'],       null),
  card('007', 'Vault of Echoes', 'gear',        ['Colorless'],     1),
  card('008', 'Mirefoot Scout',  'unit',        ['Calm'],          1, { might: 1 }),
  // Same collector number in a different set: ambiguous without a set code.
  { ...card('008', 'Sunward Pilgrim', 'unit', ['Mind'], 4), id: 'alt-008-001', setCode: 'ALT' },
  // Alternate-art printing of 001: same card, DIFFERENT printing.
  { ...card('001a', 'Lantern Warden', 'unit', ['Fury'], 3), id: 'tst-001a-001' },
  // Signature cards (103.2.d). Real ones are Spell/Unit/Gear carrying one
  // champion tag; 020-022 belong to the test legend, 023 to somebody else.
  card('020', 'Ashen Rite',      'spell', ['Fury'],  2, { supertype: 'Signature', tags: ['Ashen'] }),
  card('021', 'Ashen Brand',     'gear',  ['Fury'],  1, { supertype: 'Signature', tags: ['Ashen'] }),
  card('022', 'Ashen Shade',     'unit',  ['Fury'],  3, { supertype: 'Signature', tags: ['Ashen'], might: 2 }),
  card('023', 'Mirefoot Ambush', 'spell', ['Fury'],  2, { supertype: 'Signature', tags: ['Mirefoot'] }),
];
