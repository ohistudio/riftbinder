// Binder — scan matching. Pure functions, no Lens Studio runtime.
//
// The vision model transcribes printed text; it never identifies cards. All
// identity decisions happen here, against the local CardSource.
//
// Precedence (BINDER.md § Identification pipeline step 4):
//   1. exact set code + collector number  -> outright win
//   2. exact collector number, one match  -> outright win
//   3. normalised Levenshtein on the name -> scored, thresholded

import type { Card, CardSource, ScanResult, VisionTranscription } from './Types.ts';

/** Fold OCR noise that carries no identity: case, accents, punctuation, spacing. */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "007" and "7" are the same printing; "P-07" is not "07". */
export function normalizeCollectorNumber(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.replace(/^0+(?=\d)/, '');
}

export function normalizeSetCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Classic Levenshtein, two-row rolling buffer. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    const swap = prev; prev = curr; curr = swap;
  }
  return prev[b.length];
}

/** 1.0 == identical, 0.0 == nothing in common. Length-normalised. */
export function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const longest = a.length > b.length ? a.length : b.length;
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * How well `query` matches the OPENING of `name`. Both already normalised.
 *
 * Riftbound prints the champion name large and the subtitle beneath it, so
 * vision routinely returns "Rengar" while the catalogue stores "Rengar -
 * Pouncing". Plain edit distance scores that pair 0.4 and the card is rejected
 * as unmatched — a title-only read is the normal case, not an edge case.
 *
 * Must land on a word boundary: "reng" is not a read of "rengar".
 */
export function prefixScore(query: string, name: string): number {
  if (query.length === 0 || name.length === 0) return 0;
  if (query === name) return 1;
  return name.indexOf(`${query} `) === 0 ? 0.9 : 0;
}

/** Score every card by name similarity, best first. Ties break on name length. */
export function rankByName(
  cards: readonly Card[],
  query: string,
  limit: number,
): { card: Card; score: number }[] {
  const q = normalizeName(query);
  const scored = cards.map((card) => {
    const name = normalizeName(card.name);
    return { card, score: Math.max(similarity(q, name), prefixScore(q, name)) };
  });
  scored.sort((x, y) => (y.score - x.score) || (x.card.name.length - y.card.name.length));
  return limit >= 0 ? scored.slice(0, limit) : scored;
}

export interface MatchOptions {
  autoAcceptThreshold: number;
  maxAlternatives: number;
  minAlternativeScore: number;
}

/**
 * Turn a vision transcription into a ScanResult. `confidence` is the local
 * match score, never anything the model claimed about itself.
 */
export function matchTranscription(
  t: VisionTranscription,
  source: CardSource,
  opts: MatchOptions,
): ScanResult {
  const rawName = t.name ?? '';
  const rawCollectorNumber = t.collectorNumber;
  const cards = source.all();

  // 1 + 2: the collector number identifies the printing, so it outranks the name.
  if (rawCollectorNumber !== null && rawCollectorNumber.trim() !== '') {
    const wantNum = normalizeCollectorNumber(rawCollectorNumber);
    const wantSet = t.setCode !== null ? normalizeSetCode(t.setCode) : null;

    const numberMatches = cards.filter(
      (c) => normalizeCollectorNumber(c.collectorNumber) === wantNum,
    );

    const exact = wantSet === null
      ? []
      : numberMatches.filter((c) => normalizeSetCode(c.setCode) === wantSet);

    const winner = exact.length === 1 ? exact[0]
      : numberMatches.length === 1 ? numberMatches[0]
      : null;

    if (winner !== null) {
      return {
        rawName,
        rawCollectorNumber,
        confidence: 1,
        matched: winner.id,
        alternatives: [],
      };
    }

    // Ambiguous number (same number across sets, no readable set code):
    // fall through to the name, but only among those printings.
    if (numberMatches.length > 1) {
      // A set code that matches NO set is a misread, not a fact — "UNI" for
      // UNL is one letter out. When the number and the name together single
      // out exactly one printing, that printing is the card, and the bad set
      // code should not be allowed to veto it. Still local, still exact: this
      // never picks between two plausible cards, only confirms a lone one.
      const q = normalizeName(rawName);
      const byName = q.length === 0 ? [] : numberMatches.filter((c) => {
        const n = normalizeName(c.name);
        return n === q || prefixScore(q, n) > 0;
      });
      // One card, or several printings of one card — which for a deck is the
      // same thing. Rengar - Trophy Hunter is #120 in both UNL and OPP, and a
      // read of "UNI" cannot say which; refusing to choose between two copies
      // of the SAME card is the tie guard being right about the wrong
      // question. Prefer the printing whose set code the read is nearest to.
      const oneCard = byName.length > 0
        && byName.every((c) => normalizeName(c.name) === normalizeName(byName[0].name));
      if (oneCard) {
        const nearest = wantSet === null ? byName[0] : byName.reduce((best, c) => (
          similarity(wantSet, normalizeSetCode(c.setCode))
            > similarity(wantSet, normalizeSetCode(best.setCode)) ? c : best));
        return {
          rawName,
          rawCollectorNumber,
          confidence: 0.96,
          matched: nearest.id,
          alternatives: [],
        };
      }
      const ranked = rankByName(numberMatches, rawName, opts.maxAlternatives);
      return buildResult(rawName, rawCollectorNumber, ranked, opts);
    }
  }

  // 3: name only.
  const ranked = rankByName(cards, rawName, opts.maxAlternatives);
  return buildResult(rawName, rawCollectorNumber, ranked, opts);
}

function buildResult(
  rawName: string,
  rawCollectorNumber: string | null,
  ranked: { card: Card; score: number }[],
  opts: MatchOptions,
): ScanResult {
  const best = ranked.length > 0 ? ranked[0] : null;
  const confidence = best !== null ? best.score : 0;

  // A tie is not a match. "Rengar" opens both "Rengar - Pouncing" and "Rengar -
  // Trophy Hunter"; picking whichever sorted first would silently add the wrong
  // printing to the deck. Offer them instead and let the user say which.
  const tied = ranked.length > 1 && ranked[1].score === confidence;

  if (best !== null && !tied && confidence >= opts.autoAcceptThreshold) {
    return { rawName, rawCollectorNumber, confidence, matched: best.card.id, alternatives: [] };
  }

  const alternatives = ranked
    .filter((r) => r.score >= opts.minAlternativeScore)
    .slice(0, opts.maxAlternatives)
    .map((r) => r.card.id);

  return { rawName, rawCollectorNumber, confidence, matched: null, alternatives };
}
