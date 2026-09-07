// Binder — the grounded agent. Pure: no runtime, no network.
//
// BINDER.md § Grounding is the whole point of this file. Gemini does not know
// Riftbound — the game is newer than the training data — so it is never asked
// what to play. It is handed real cards and asked to rank and justify them.
//
//   selectCandidates()   local retrieval, deterministic
//   buildSuggestionPrompt()  puts those exact cards in front of the model
//   parseAgentResponse()     drops anything that was not in the candidate set
//
// The last step is the safety net: if the model invents a card id, or repeats
// one, or wraps its JSON in prose, none of it reaches the wall.

import type { Card, Deck } from './Types.ts';
import type { CardFilter } from './Search.ts';
import { applyFilter, isEmptyFilter } from './Search.ts';
import type { BuildStage } from './Browse.ts';
import { stageOf, stagePool } from './Browse.ts';

// Re-exported so callers need only one import for the build-order concepts.
export { stageOf };
export type { BuildStage };

const STAGE_BRIEF: { [key: string]: string } = {
  legend: 'The deck has no Champion Legend yet. Suggest LEGENDS only. The legend fixes the '
    + 'deck\'s domain identity, so explain what each one\'s domains let the deck do.',
  champion: 'The legend is chosen but there is no Chosen Champion yet. Suggest CHAMPION UNITS '
    + 'whose champion tag matches the legend. It sits in the Champion Zone and counts toward the 40.',
  battlefields: 'Choosing BATTLEFIELDS. Three are needed and each must have a different name. '
    + 'They carry no domain, so any of them is legal — judge them on what they do.',
  runes: 'Choosing RUNES. Twelve are needed and every one must sit inside the legend\'s '
    + 'domain identity. Suggest a spread that supports the deck\'s energy needs.',
  deck: 'Legend and Chosen Champion are set. Suggest main-deck cards that fit the deck\'s '
    + 'domain identity and fill out its energy curve.',
};

export interface AgentPick {
  cardId: string;
  reason: string;
}

export interface AgentResponse {
  summary: string;
  picks: AgentPick[];
  /** Ids the model returned that were not offered. Kept for logging, never shown. */
  rejected: string[];
}

/** Prompt size guard — a wall of 1451 cards would blow the context window. */
// 18, not 40. Every candidate carries its full rules text, so forty of them
// made a prompt long enough to be a real share of the round trip. Eighteen is
// still more than anyone asks about at once, and the shortlist is chosen
// locally anyway — see selectCandidates.
export const MAX_CANDIDATES = 18;

/**
 * Pick the cards worth showing the model. Deterministic and local: domain fit
 * from the deck's legend, then any filter parsed from the request, then a
 * stable ordering so the same question twice gives the same candidates.
 */
export function selectCandidates(
  cards: readonly Card[],
  deck: Deck,
  filter: CardFilter,
  byId: (cardId: string) => Card | null,
  limit: number = MAX_CANDIDATES,
  /** Already offered and turned down — never offer them again this session. */
  exclude: readonly string[] = [],
): Card[] {
  const stage = stageOf(deck);

  // Only STRUCTURAL clauses survive here.
  //
  // The free-text remainder is conversation, not a card name: "suggest cheap
  // aggressive units" would otherwise filter for a card called "suggest
  // aggressive" and match nothing. And the stage dictates the card TYPE, so a
  // type clause is dropped before the legend and champion stages, where it
  // would intersect to an empty pool.
  //
  // Both strips live here rather than in the caller, because a caller that
  // forgets either gets a silently empty answer to a reasonable question.
  const effective = {
    ...filter,
    text: null,
    types: stage === 'deck' ? filter.types : [],
  };

  // The same pool the user can browse — see Browse.stagePool. Sharing it means
  // the agent can never offer a card the wall would refuse, or vice versa.
  const legal = stagePool(cards, deck, byId);
  let pool = isEmptyFilter(effective) ? legal : applyFilter(legal, effective);

  const dismissed = new Set(exclude);
  pool = pool.filter((c) => !dismissed.has(c.id));

  // Stable order: cheap first (the curve usually needs the bottom filled), then
  // by id so ties never reshuffle between identical questions.
  pool.sort((a, b) => {
    const ae = a.energy === null ? 99 : a.energy;
    const be = b.energy === null ? 99 : b.energy;
    return (ae - be) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });

  return pool.slice(0, Math.max(0, limit));
}

function describeCard(card: Card): string {
  const stats: string[] = [];
  if (card.energy !== null) stats.push(`energy ${card.energy}`);
  if (card.might !== null) stats.push(`might ${card.might}`);
  if (card.power !== null) stats.push(`power ${card.power}`);
  const domains = card.domains.length > 0 ? card.domains.join('/') : 'none';
  const tags = card.tags.length > 0 ? ` | tags: ${card.tags.join(', ')}` : '';
  const stat = stats.length > 0 ? ` | ${stats.join(', ')}` : '';
  return `- ${card.id} | ${card.name} | ${card.type} | ${domains}${stat}${tags} | ${card.text}`;
}

function describeDeck(deck: Deck, byId: (cardId: string) => Card | null): string {
  const lines: string[] = [];
  const legend = deck.legendId === null ? null : byId(deck.legendId);
  lines.push(`Legend: ${legend === null ? 'none chosen' : `${legend.name} (${legend.domains.join('/')})`}`);
  if (deck.main.length === 0) lines.push('Main deck: empty');
  else {
    lines.push('Main deck:');
    for (const slot of deck.main) {
      const card = byId(slot.cardId);
      if (card !== null) lines.push(`  ${slot.count}x ${card.name} (energy ${card.energy ?? '-'})`);
    }
  }
  return lines.join('\n');
}

/**
 * The model may only answer with ids from CANDIDATES. That instruction is
 * repeated because it is the one rule whose violation is invisible in a demo —
 * an invented card looks exactly like a real suggestion.
 */
export function buildSuggestionPrompt(
  request: string,
  candidates: readonly Card[],
  deck: Deck,
  byId: (cardId: string) => Card | null,
  /** The card the user is currently looking at, if any. */
  focus: Card | null = null,
): string {
  return [
    'You are helping build a deck for the Riftbound trading card game.',
    '',
    `STAGE: ${STAGE_BRIEF[stageOf(deck)]}`,
    '',
    'RULES:',
    '1. Suggest ONLY cards from the CANDIDATES list below. Never name a card that is not in it.',
    '2. Answer with the card id exactly as written in CANDIDATES.',
    '3. Reason about synergy, energy curve and domain fit, using the card text you are given.',
    '   You have NO metagame data: no win rates, no play rates, no tier lists, and no record',
    '   of what has been played recently or is popular. If asked about any of those, say you',
    '   do not have that information and answer from card text instead. Never invent it.',
    '4. Suggest at most 5 cards. Fewer is fine if fewer fit.',
    '5. Reply with JSON only, no prose outside it, in exactly this shape:',
    '   {"summary": "one sentence", "picks": [{"id": "<candidate id>", "reason": "one short sentence"}]}',
    '',
    'CURRENT DECK:',
    describeDeck(deck, byId),
    '',
    focus === null ? '' : `THE USER IS LOOKING AT: ${describeCard(focus)}`,
    focus === null ? '' : 'If they say "this" or "it", they mean that card.',
    '',
    `REQUEST: ${request}`,
    '',
    'CANDIDATES:',
    candidates.map(describeCard).join('\n'),
  ].join('\n');
}

/**
 * A grounded "tell me about this card" prompt. Same rules as suggestions: the
 * model reasons from the card text it is GIVEN, never from memory, and meta
 * data is explicitly off the table (BINDER.md hard IP constraint).
 */
export function buildCardFactsPrompt(card: Card): string {
  return [
    'You are explaining one Riftbound trading card to the player holding it.',
    '',
    'Use ONLY the card data below. No metagame data: no win rates, play rates,',
    'tier lists or popularity. If the text is ambiguous, say what it literally does.',
    '',
    'Reply in plain prose, no JSON, no headings: two short sentences on what the',
    'card does and when it is at its best, then one sentence starting "Tip:" with',
    'a practical deckbuilding pointer. At most 60 words in total.',
    '',
    'CARD:',
    describeCard(card),
    card.flavourText === null ? '' : `FLAVOUR (not rules): ${card.flavourText}`,
  ].join('\n');
}

// --- Response parsing --------------------------------------------------

/**
 * Pull the first JSON object out of a model reply. Handles ```json fences,
 * leading and trailing prose, and a truncated tail — a cut-off response is the
 * common failure when the model hits a token limit mid-answer, and losing the
 * whole reply for a missing brace would be a poor trade.
 */
export function extractJson(raw: string): string | null {
  if (raw === null || raw === undefined) return null;
  const withoutFences = raw.replace(/```[a-zA-Z]*/g, '');
  const start = withoutFences.indexOf('{');
  if (start === -1) return null;

  // Track BOTH braces and brackets: a truncated reply usually cuts inside the
  // picks array, and closing only the objects leaves the array open.
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < withoutFences.length; i++) {
    const ch = withoutFences[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (stack.length === 0) return withoutFences.slice(start, i + 1);
    }
  }

  // Unbalanced: the reply was truncated. Close what is still open, innermost
  // first, so a cut-off answer still yields the picks it did finish.
  let repaired = withoutFences.slice(start);
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i--) repaired += stack[i] === '{' ? '}' : ']';
  return repaired;
}

/**
 * Parse and GROUND the reply. Any id not in `candidateIds` is discarded into
 * `rejected` rather than displayed — this is the hallucination guard, and the
 * reason the model is never trusted with card identity.
 */
export function parseAgentResponse(raw: string, candidateIds: readonly string[]): AgentResponse {
  const empty: AgentResponse = { summary: '', picks: [], rejected: [] };
  const json = extractJson(raw);
  if (json === null) return empty;

  let parsed: any;
  try { parsed = JSON.parse(json); } catch (e) { return empty; }
  if (parsed === null || typeof parsed !== 'object') return empty;

  const allowed = new Set(candidateIds);
  const seen = new Set<string>();
  const picks: AgentPick[] = [];
  const rejected: string[] = [];

  const rawPicks = Array.isArray(parsed.picks) ? parsed.picks : [];
  for (const pick of rawPicks) {
    if (pick === null || typeof pick !== 'object') continue;
    const id = typeof pick.id === 'string' ? pick.id.trim() : '';
    if (id === '') continue;
    if (!allowed.has(id)) { rejected.push(id); continue; }
    if (seen.has(id)) continue;              // repeated pick, not a second card
    seen.add(id);
    const reason = typeof pick.reason === 'string' ? pick.reason.trim() : '';
    picks.push({ cardId: id, reason });
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  return { summary, picks, rejected };
}
