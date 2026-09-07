// Binder — what travels between two people sharing a deck. Pure.
//
// SyncKit offers two transports with very different shapes, and the split here
// follows them exactly:
//
//   StorageProperty  ~100KB, and REPLAYS to whoever joins late  -> the deck
//   sendEvent        ~1KB, never replayed, fire and forget      -> one edit
//
// So the deck itself travels as STATE (a late joiner opens their eyes and the
// deck is simply there), and each edit travels as a SIGNAL routed to whoever
// owns the deck. The owner applies it and the new deck replicates back. That
// is the §6.5 Scoreboard shape: one writer, everybody else asks.
//
// Nothing here touches SyncKit. It is all pure so the format can be tested
// without a session, two headsets, or a network.

import type { Deck } from './Types';
import type { Intent } from './Intents';
import { parseDeck } from './DeckLibrary';

/**
 * Which intents are allowed to cross the wire.
 *
 * A whitelist, and deliberately not "everything that changes the deck". What
 * arrives from a peer is UNTRUSTED INPUT: it is decoded and then dispatched
 * into the same reducer as a local button press. So the list holds only edits
 * to the shared deck — nothing that spends money, reaches the network, or
 * moves the other person's view.
 *
 * Not shareable, and each for a reason:
 *   ASK / PRICE_CARD  spend Gemini quota — a peer must not be able to bill you
 *   SCAN              opens YOUR camera
 *   EXPORT / SAVE     writes to your storage
 *   FOCUS / SCROLL    your eyes, not theirs (BINDER.md: a shared cursor would
 *                     make browsing a fight)
 */
export const SHAREABLE_KINDS: readonly string[] = [
  'ADD', 'REMOVE', 'AUTO_RUNES', 'CLEAR', 'SIDEBOARD', 'SELECT', 'TOGGLE_OWNED',
];

/** The ceiling sendEvent silently drops past. Measured in bytes, not characters. */
export const EDIT_MAX_WIRE_BYTES = 1024;

function byteLength(text: string): number {
  // No TextEncoder in the Lens runtime. Count UTF-8 the long way; the strings
  // here are short, and being wrong about the limit costs a silent drop.
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i += 1; }   // surrogate pair
    else bytes += 3;
  }
  return bytes;
}

export function isShareable(intent: Intent): boolean {
  return SHAREABLE_KINDS.indexOf(intent.kind) !== -1;
}

/** The deck as state. Undefined fields are dropped by JSON.stringify. */
export function serialiseDeck(deck: Deck): string {
  return JSON.stringify(deck);
}

/**
 * Read a deck off the wire, or null if what arrived is not one.
 *
 * Reuses the storage parser rather than trusting the sender: a peer running an
 * older build, or a half-written value, must not be able to crash the session.
 */
export function parseDeckWire(json: string): Deck | null {
  if (json.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return null;
  }
  return parseDeck(parsed);
}

/**
 * Encode one edit. Returns null when it must not be sent — either it is not a
 * shareable kind, or it would exceed what sendEvent carries.
 *
 * Returning null rather than throwing keeps the caller honest: a send that
 * cannot happen is a normal outcome, not an error to swallow.
 */
export function encodeIntent(intent: Intent): string | null {
  if (!isShareable(intent)) return null;
  const json = JSON.stringify(intent);
  return byteLength(json) > EDIT_MAX_WIRE_BYTES ? null : json;
}

/**
 * Decode an edit from a peer.
 *
 * Re-checks the whitelist AFTER parsing. Encoding is done by us; decoding is
 * done to somebody else's bytes, so the guard has to exist on this side too —
 * that is the whole point of validating input rather than trusting the sender.
 */
export function decodeIntent(raw: unknown): Intent | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;

  const source = parsed as Record<string, unknown>;
  if (typeof source.kind !== 'string') return null;
  if (SHAREABLE_KINDS.indexOf(source.kind) === -1) return null;

  // Field-level checks, because a kind alone does not make the payload sane.
  // A NaN count would poison every later arithmetic on the slot.
  if ('cardId' in source && source.cardId !== null && typeof source.cardId !== 'string') return null;
  if ('count' in source) {
    const count = source.count;
    if (typeof count !== 'number' || !isFinite(count) || count < 0) return null;
  }
  return parsed as Intent;
}

/**
 * Which of two decks is the current one.
 *
 * Last write wins on `updatedAt`, which every mutation bumps. Ties keep the
 * one already held: a redundant replace would restart animations and lose the
 * local scroll for no gain.
 */
export function newerDeck(held: Deck, arrived: Deck): Deck {
  return arrived.updatedAt > held.updatedAt ? arrived : held;
}
