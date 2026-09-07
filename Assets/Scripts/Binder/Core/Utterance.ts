// Binder — spoken phrase -> Intent. Pure, no runtime, no network.
//
// Deliberately deterministic and local. BINDER.md § Interaction requires every
// intent to be reachable without the network, and routing speech through Gemini
// just to recognise the word "scan" would make the whole experience fail when
// the connection drops. Anything this does NOT recognise falls through to ASK,
// where the agent handles it — so the fallback is the interesting path, not an
// error case.

import type { Intent } from './Intents';
import * as I from './Intents';

const WORD_NUMBERS: { [word: string]: number } = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const ORDINALS: { [word: string]: number } = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  one: 1, two: 2, three: 3, four: 4, five: 5,
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function countIn(words: readonly string[]): number {
  for (const word of words) {
    if (word in WORD_NUMBERS) return WORD_NUMBERS[word];
    const n = parseInt(word, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 1;
}

/**
 * `focusedCardId` is what gaze is currently on. ADD and REMOVE need it — the
 * contract marks both as gaze-dependent — and return null without it rather
 * than guessing at a target.
 */
export function parseUtterance(text: string, focusedCardId: string | null): Intent | null {
  const phrase = normalize(text);
  if (phrase === '') return null;
  const words = phrase.split(' ');
  const has = (w: string): boolean => words.indexOf(w) !== -1;

  // Checked before SEARCH: "show everything" is a clear, not a query.
  if (phrase === 'show everything' || phrase === 'clear' || phrase === 'show all'
    || phrase === 'clear the filter' || phrase === 'reset') {
    return I.clear();
  }

  if (has('scan') || phrase === 'read this card') return I.scan(null);

  if (has('export') || phrase.indexOf('save the list') !== -1 || phrase.indexOf('save my deck') !== -1) {
    return I.exportDeck();
  }

  // "the second one" — disambiguating a scan.
  const pickMatch = phrase.match(/\bthe (\w+) one\b/);
  if (pickMatch !== null && pickMatch[1] in ORDINALS) return I.pick(ORDINALS[pickMatch[1]]);

  if (has('add')) {
    if (focusedCardId === null) return null;
    return I.add(focusedCardId, countIn(words));
  }

  if (has('remove') || phrase.indexOf('take') !== -1) {
    if (focusedCardId === null) return null;
    return I.remove(focusedCardId, countIn(words));
  }

  // Require an explicit scroll/page word. Matching a bare "up" or "down" ate
  // sentences like "something that trades up against three drops".
  const scrollWord = has('scroll') || has('page');
  if (scrollWord && (has('down') || has('next') || has('more'))) return I.scroll(2);
  if (scrollWord && (has('up') || has('previous') || has('back'))) return I.scroll(-2);

  // Filter-shaped phrasing goes to local search; everything else is a question
  // for the agent. "show me units under four" filters; "what goes with this
  // legend" does not.
  const looksLikeFilter = phrase.indexOf('show me') === 0 || phrase.indexOf('only ') === 0
    || phrase.indexOf('filter') === 0 || phrase.indexOf('find ') === 0;
  if (looksLikeFilter) return I.search(text);

  return I.ask(text);
}
