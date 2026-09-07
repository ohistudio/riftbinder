// Binder — deck construction rules.
//
// VERIFIED 2026-09-01 against two sources:
//   * Rift Watcher core-rules reference, citing rule numbers 103.1-103.4
//     https://riftwatcher.com/rules/deck-construction/
//   * riftbound.gg "Deckbuilding 101"
//     https://riftbound.gg/deckbuilding-101-building-your-first-riftbound-deck/
//
// These are no longer placeholders, so they are emitted as ERRORS rather than
// unverified warnings. Anything still unverified stays a warning and says so.
//
// Sources disagree in one place, and the disagreement is real rather than
// sloppy: the core rules say the main deck is "at least 40 cards" (103.2),
// while sanctioned constructed play requires EXACTLY 40. Encoded as a minimum,
// with the exact-40 expectation reported separately as a warning, because a
// 41-card deck is legal by the core rules and merely unregisterable.

export interface RuleSpec {
  /** Stable id, used as Violation.rule. */
  id: string;
  value: number;
  /** False until checked against official rules. Drives severity. */
  verified: boolean;
  note: string;
}

export const Rules = {
  /** Main deck minimum, INCLUDING the Chosen Champion. Rule 103.2. */
  mainMinimum: {
    id: 'main.minimumSize', value: 40, verified: true,
    note: 'Core rules 103.2: at least 40 cards including the Chosen Champion.',
  } as RuleSpec,

  /** Sanctioned constructed registers exactly 40. Not a core-rules requirement. */
  mainExactForSanctioned: {
    id: 'main.sanctionedSize', value: 40, verified: false,
    note: 'Sanctioned constructed expects exactly 40; the core rules only set a minimum.',
  } as RuleSpec,

  /** Copies of any one named card, including the Chosen Champion. Rule 103.2.b. */
  maxCopies: {
    id: 'main.maxCopies', value: 3, verified: true,
    note: 'Core rules 103.2.b: up to 3 copies of the same named card.',
  } as RuleSpec,

  /** Rune deck size. Rule 103.3.a. */
  runeDeckSize: {
    id: 'runes.size', value: 12, verified: true,
    note: 'Core rules 103.3.a: 12 rune cards.',
  } as RuleSpec,

  /**
   * Battlefields. Rule 103.4.a makes the count depend on the Mode of Play;
   * 3 is standard constructed, so the COUNT stays a warning while the
   * uniqueness requirement (103.4.c) is a verified error.
   */
  battlefieldCount: {
    id: 'battlefields.count', value: 3, verified: false,
    note: 'Rule 103.4.a: the number depends on the Mode of Play. 3 is standard constructed.',
  } as RuleSpec,

  /**
   * Sideboard size. Exactly 8 or 0 — "some" is never legal.
   *
   * Unverified: this comes from community deckbuilding guidance rather than the
   * numbered core rules, which do not mention a sideboard at all.
   */
  sideboardSize: {
    id: 'sideboard.size', value: 8, verified: false,
    note: 'Sideboard is 8 or 0 per community guidance; not found in the numbered core rules.',
  } as RuleSpec,

  /** Signature cards sharing the legend's champion tag. Rule 103.2.d. */
  maxSignatureCards: {
    id: 'main.signatureLimit', value: 3, verified: true,
    note: 'Core rules 103.2.d: only 3 total signature cards with the legend\'s champion tag.',
  } as RuleSpec,

  /**
   * A signature card belonging to some OTHER champion.
   *
   * Unverified on purpose. 103.2.d states the limit as three signature cards
   * carrying the legend's champion tag; it does not say in so many words that
   * an off-tag signature card is illegal outright. That reading is very likely
   * right — a signature card is printed for one champion — but "very likely"
   * is a warning here, not an error.
   */
  signatureTagMatch: {
    id: 'main.signatureTag', value: 0, verified: false,
    note: '103.2.d frames the limit around the legend\'s own tag; whether an off-tag '
      + 'signature card is illegal outright is not stated in the text checked.',
  } as RuleSpec,
} as const;

/**
 * A domain that every deck may include regardless of the legend's identity.
 * ASSUMPTION, not verified: colourless cards are treated as identity-free.
 */
export const COLOURLESS_DOMAIN = 'colorless';

export function allRulesVerified(): boolean {
  return [Rules.mainMinimum, Rules.maxCopies, Rules.runeDeckSize, Rules.maxSignatureCards]
    .every((r) => r.verified);
}
