// Binder — card filtering. Pure, no runtime, no network.
//
// BINDER.md § Grounding: the model's only job is turning a spoken phrase into a
// CardFilter. Everything below runs locally on the real catalogue, so a filter
// can narrow, widen or return nothing — but it can never invent a card.

import type { Card, CardType, Domain } from './Types';
import { normalizeName, similarity } from './Matching';

export interface CardFilter {
  /** Fuzzy name match. Null means "any name". */
  text: string | null;
  /** Empty means "any type". */
  types: CardType[];
  /** Empty means "any domain". A card matches if it has ANY of these. */
  domains: Domain[];
  energyMin: number | null;
  energyMax: number | null;
  /** Empty means "any tag". A card matches if it has ANY of these. */
  tags: string[];
}

export function emptyFilter(): CardFilter {
  return { text: null, types: [], domains: [], energyMin: null, energyMax: null, tags: [] };
}

export function isEmptyFilter(filter: CardFilter): boolean {
  return filter.text === null && filter.types.length === 0 && filter.domains.length === 0
    && filter.energyMin === null && filter.energyMax === null && filter.tags.length === 0;
}

const NAME_THRESHOLD = 0.62;

function lower(values: readonly string[]): string[] {
  return values.map((v) => v.trim().toLowerCase()).filter((v) => v !== '');
}

/** Every clause is AND-ed; values within a clause are OR-ed. */
export function matchesFilter(card: Card, filter: CardFilter): boolean {
  if (filter.types.length > 0 && filter.types.indexOf(card.type) === -1) return false;

  if (filter.domains.length > 0) {
    const wanted = lower(filter.domains);
    const has = lower(card.domains).some((d) => wanted.indexOf(d) !== -1);
    if (!has) return false;
  }

  if (filter.tags.length > 0) {
    const wanted = lower(filter.tags);
    const has = lower(card.tags).some((t) => wanted.indexOf(t) !== -1);
    if (!has) return false;
  }

  // A card with no energy (legend, battlefield) is excluded by any energy bound
  // rather than treated as zero — "under four" should not surface every legend.
  if (filter.energyMin !== null || filter.energyMax !== null) {
    if (card.energy === null) return false;
    if (filter.energyMin !== null && card.energy < filter.energyMin) return false;
    if (filter.energyMax !== null && card.energy > filter.energyMax) return false;
  }

  if (filter.text !== null) {
    const query = normalizeName(filter.text);
    if (query !== '') {
      const name = normalizeName(card.name);
      const substring = name.indexOf(query) !== -1;
      if (!substring && similarity(query, name) < NAME_THRESHOLD) return false;
    }
  }

  return true;
}

export function applyFilter(cards: readonly Card[], filter: CardFilter): Card[] {
  if (isEmptyFilter(filter)) return cards.slice();
  return cards.filter((card) => matchesFilter(card, filter));
}

export function describeFilter(filter: CardFilter): string {
  if (isEmptyFilter(filter)) return 'everything';
  const parts: string[] = [];
  if (filter.types.length > 0) parts.push(filter.types.join('/'));
  if (filter.domains.length > 0) parts.push(filter.domains.join('/'));
  if (filter.tags.length > 0) parts.push(filter.tags.join('/'));
  if (filter.energyMin !== null && filter.energyMax !== null) {
    parts.push(filter.energyMin === filter.energyMax
      ? `energy ${filter.energyMin}`
      : `energy ${filter.energyMin}-${filter.energyMax}`);
  } else if (filter.energyMax !== null) parts.push(`energy <= ${filter.energyMax}`);
  else if (filter.energyMin !== null) parts.push(`energy >= ${filter.energyMin}`);
  if (filter.text !== null) parts.push(`"${filter.text}"`);
  return parts.join(', ');
}

// --- Local parser ------------------------------------------------------
//
// Gemini owns parsing in Phase 2. This deterministic parser exists so search
// works with the network down — which BINDER.md § Interaction requires of every
// intent, and which is how the debug panel drives search today. It handles the
// common shapes only and is not trying to be clever.

const WORD_NUMBERS: { [word: string]: number } = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const TYPE_WORDS: { [word: string]: CardType } = {
  unit: 'unit', units: 'unit',
  spell: 'spell', spells: 'spell',
  gear: 'gear', gears: 'gear',
  rune: 'rune', runes: 'rune',
  legend: 'legend', legends: 'legend',
  battlefield: 'battlefield', battlefields: 'battlefield',
};

function readNumber(token: string): number | null {
  if (token in WORD_NUMBERS) return WORD_NUMBERS[token];
  const parsed = parseInt(token, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * `knownDomains` comes from the catalogue rather than a hardcoded list, so new
 * domains become searchable the moment they appear in card data.
 */
export function parseFilter(query: string, knownDomains: readonly string[]): CardFilter {
  const filter = emptyFilter();
  const tokens = normalizeName(query).split(' ').filter((t) => t !== '');
  if (tokens.length === 0) return filter;

  const domainLookup = new Map<string, string>();
  for (const domain of knownDomains) domainLookup.set(domain.trim().toLowerCase(), domain);

  const nameWords: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token in TYPE_WORDS) {
      const type = TYPE_WORDS[token];
      if (filter.types.indexOf(type) === -1) filter.types.push(type);
      continue;
    }

    const domain = domainLookup.get(token);
    if (domain !== undefined) {
      if (filter.domains.indexOf(domain) === -1) filter.domains.push(domain);
      continue;
    }

    // "under four" / "below 4" / "cheaper than three"
    if (token === 'under' || token === 'below' || token === 'cheaper') {
      const value = readNumber(tokens[i + 1] ?? '') ?? readNumber(tokens[i + 2] ?? '');
      if (value !== null) { filter.energyMax = value - 1; i++; continue; }
    }
    if (token === 'over' || token === 'above') {
      const value = readNumber(tokens[i + 1] ?? '');
      if (value !== null) { filter.energyMin = value + 1; i++; continue; }
    }
    // "costs three" / "energy 3"
    if (token === 'cost' || token === 'costs' || token === 'energy') {
      const value = readNumber(tokens[i + 1] ?? '');
      if (value !== null) { filter.energyMin = value; filter.energyMax = value; i++; continue; }
    }

    // Structural words carry no meaning on their own.
    if (['show', 'me', 'only', 'all', 'the', 'a', 'an', 'with', 'find', 'card', 'cards', 'than'].indexOf(token) !== -1) continue;

    nameWords.push(token);
  }

  if (nameWords.length > 0) filter.text = nameWords.join(' ');
  return filter;
}
