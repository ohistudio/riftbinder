// Binder — asking about the card you are looking at. Pure, no Lens runtime.
//
// The card is GIVEN to the model from the local catalogue rather than recalled
// by it — the same grounding rule the suggestion agent and the scanner follow.
//
// Price is the exception and is treated as one. There is no pricing source
// wired in, so a price is the model's recollection: an estimate, a RANGE, with
// a confidence the view is required to show. See buildPricePrompt.
//
// (Asking what a card DOES already lives in buildCardFactsPrompt — this file
// deliberately does not offer a second way to do that.)

import type { Card } from './Types';
import { extractJson } from './AgentPrompt';

/** The printed facts, so the model reasons rather than remembers. */
export function describeCardForModel(card: Card): string {
  const parts: string[] = [
    `Name: ${card.name}`,
    `Set: ${card.setCode} ${card.collectorNumber}`,
    `Type: ${card.supertype === null ? card.type : `${card.supertype} ${card.type}`}`,
    `Domains: ${card.domains.join(', ')}`,
  ];
  if (card.energy !== null) parts.push(`Energy: ${card.energy}`);
  if (card.might !== null) parts.push(`Might: ${card.might}`);
  if (card.power !== null) parts.push(`Power: ${card.power}`);
  if (card.text.length > 0) parts.push(`Rules text: ${card.text}`);
  return parts.join('\n');
}

export interface PriceEstimate {
  low: number | null;
  high: number | null;
  currency: string;
  confidence: 'high' | 'medium' | 'low';
  note: string;
}

/**
 * "What is it worth?" — an ESTIMATE, and asked so the answer can admit it.
 *
 * There is no pricing API here, so this is the model's recollection of a real
 * market. That is worth money to get wrong, so the prompt insists on a range,
 * insists on a confidence, and explicitly permits "I do not know" — the answer
 * we want when it does not, instead of a confident invented figure.
 */
export function buildPricePrompt(card: Card): string {
  return [
    'Estimate the secondary-market price of this trading card.',
    '',
    describeCardForModel(card),
    `Rarity: ${card.rarity}`,
    '',
    'This is a RECOLLECTION, not a lookup, and it will be shown to someone as',
    'an estimate. Give a RANGE, never a single figure. If you do not genuinely',
    'recognise this card or cannot recall its price, return nulls with',
    'confidence "low" — that is a useful answer and a wrong number is not.',
    'Do not guess from the rarity alone.',
    '',
    'Reply with JSON only:',
    '{"low": number|null, "high": number|null, "currency": "USD",',
    ' "confidence": "high"|"medium"|"low", "note": "one short clause"}',
  ].join('\n');
}

function confidenceOf(raw: unknown): 'high' | 'medium' | 'low' {
  return raw === 'high' || raw === 'medium' ? raw : 'low';
}

function money(raw: unknown): number | null {
  if (typeof raw !== 'number' || !isFinite(raw) || raw < 0) return null;
  return Math.round(raw * 100) / 100;
}

export function parsePriceResponse(reply: string): PriceEstimate {
  const unknown: PriceEstimate = {
    low: null, high: null, currency: 'USD', confidence: 'low', note: '',
  };
  const json = extractJson(reply);
  if (json === null) return unknown;

  let parsed: any;
  try { parsed = JSON.parse(json); } catch (e) { return unknown; }
  if (parsed === null || typeof parsed !== 'object') return unknown;

  let low = money(parsed.low);
  let high = money(parsed.high);
  // A range the wrong way round is a mistake, not a signal; straighten it
  // rather than showing "$8 to $2".
  if (low !== null && high !== null && low > high) { const t = low; low = high; high = t; }

  return {
    low,
    high,
    currency: typeof parsed.currency === 'string' && parsed.currency.length > 0
      ? parsed.currency : 'USD',
    confidence: confidenceOf(parsed.confidence),
    note: typeof parsed.note === 'string' ? parsed.note.trim() : '',
  };
}

/**
 * How the estimate is written on screen. Always says "est." and always says
 * when it does not know — a bare number would read as a price.
 */
export function describePrice(card: Card, price: PriceEstimate): string {
  if (price.low === null || price.high === null) {
    return `${card.name} — no price estimate (the assistant does not recall this one)`;
  }
  const range = price.low === price.high
    ? `${price.currency} ${price.low.toFixed(2)}`
    : `${price.currency} ${price.low.toFixed(2)}–${price.high.toFixed(2)}`;
  const caveat = price.confidence === 'high' ? '' : `, ${price.confidence} confidence`;
  return `${card.name} — est. ${range}${caveat}. Not a quote; check a price site.`;
}
