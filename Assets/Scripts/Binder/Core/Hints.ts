// RiftBinder — something to read while you wait. Pure.
//
// The waits in this app are real: a scan is a photograph, an upload and a model
// round trip, and the assistant takes a few seconds to answer. A spinner tells
// you nothing; a tip about the game is worth the same seconds.
//
// These are PLAY tips, written by the user, in their voice — including the ones
// that are jokes. They are not rules text and must never be mistaken for it:
// nothing here is quoted from Riot's rules, and none of it is metagame data
// (play rates, tier lists, what is winning), which BINDER.md rules out.

/**
 * Shown one at a time while something is loading.
 *
 * Order matters only in that consecutive hints should not repeat — see
 * nextHint. Add freely; the picker copes with any length above one.
 */
export const HINTS: readonly string[] = [
  'You can recycle an exhausted rune!',
  'Be wary of your opponent if they have ready runes.',
  'As attacker you can play the first action in a showdown.',
  'If you start losing, just eat your opponent\'s cards. Then call a judge for deckcheck.',
  'Don\'t worry about hidden cards, what\'s the worst that could happen?',
  'You can summon a judge at any time by speaking the invocation: "Judge!".',
  'You can\'t drink sprite tokens.',
  'You can\'t eat tasty faefolk.',
  'Buying singles is usually cheaper than ripping packs.',
  'Make sure you have enough runes before you start your combo.',
  'If your entire plan depends on your opponent not having a card, '
    + 'they probably have that card.',
];

/**
 * Pick a hint that is not the one just shown.
 *
 * `roll` is a number in [0, 1) — pass Math.random() at the call site and a
 * fixed value in tests. Taking it as an argument rather than reaching for
 * Math.random() in here is what makes this testable at all.
 *
 * Returns an INDEX so the caller can hold it and pass it back next time; that
 * is the only state involved, and it lives with the caller rather than here.
 */
export function nextHint(previous: number, roll: number): { index: number; text: string } {
  if (HINTS.length === 0) return { index: -1, text: '' };
  if (HINTS.length === 1) return { index: 0, text: HINTS[0] };

  const safeRoll = isFinite(roll) && roll >= 0 && roll < 1 ? roll : 0;
  // Choose from the OTHER hints, then map back. Picking at random and retrying
  // on a repeat can loop; this cannot, and it is uniform over what is left.
  const choice = Math.floor(safeRoll * (HINTS.length - 1));
  const bounded = Math.min(choice, HINTS.length - 2);
  const index = previous < 0 || previous >= HINTS.length
    ? bounded
    : (previous + 1 + bounded) % HINTS.length;
  return { index, text: HINTS[index] };
}
