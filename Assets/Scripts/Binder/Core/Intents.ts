// Binder — the single intent surface. Pure, no Lens Studio runtime.
//
// BINDER.md § Interaction: "Every intent fires from a tap panel with identical
// payloads." Voice (Phase 4) and the debug panel both build one of these and
// hand it to the same dispatcher, so the demo runs with voice and camera dead.

export type Intent =
  | { kind: 'SCAN'; cannedImageId: string | null }
  | { kind: 'ADD'; cardId: string; count: number }
  | { kind: 'REMOVE'; cardId: string; count: number }
  | { kind: 'SEARCH'; query: string }
  | { kind: 'ASK'; prompt: string }
  /** Re-ask, excluding everything already offered. "Not these — show me others." */
  | { kind: 'MORE' }
  /** Fill the rune deck automatically from the legend's domains. */
  | { kind: 'AUTO_RUNES' }
  /** Cycle the card panel's ordering. */
  | { kind: 'SORT' }
  /**
   * Turn AI guidance on or off. With it off the build is entirely manual: the
   * agent says nothing unless asked, and reaching a new stage does not trigger
   * a call.
   */
  | { kind: 'TOGGLE_AI' }
  | { kind: 'CLEAR' }
  | { kind: 'PICK'; ordinal: number }        // 1-based: "the second one" -> 2
  | { kind: 'EXPORT' }
  // Not user utterances in the contract's table. PAGE backs the voice-paged
  // grid; FOCUS is normally driven by gaze, and is an intent only so the debug
  // panel can drive it with no head tracking.
  /** Scroll the card panel by whole rows. */
  | { kind: 'SCROLL'; rows: number }
  | { kind: 'FOCUS'; cardId: string | null }
  /**
   * Pinch on a card. SELECT is a choice, not a commitment: it marks the card
   * and shows it large, and nothing enters the deck until NEXT confirms it.
   */
  | { kind: 'SELECT'; cardId: string | null }
  /** Confirm the current selection and move the build on. */
  | { kind: 'NEXT' }
  /** Re-place the whole layout in front of wherever the user is standing now. */
  | { kind: 'SHOW_OWNED' }                   // browse only what you own
  | { kind: 'TOGGLE_OWNED'; cardId: string }  // mark a card owned / not owned
  | { kind: 'FIND_STORES' }
  | { kind: 'SAVE_DECK' }
  | { kind: 'SIDEBOARD'; cardId: string }
  | { kind: 'PRICE_CARD'; cardId: string }
  | { kind: 'OPEN_DECK'; deckId: string }
  | { kind: 'NEW_DECK' }
  | { kind: 'RECENTER' };

export type IntentKind = Intent['kind'];

export const scan = (cannedImageId: string | null = null): Intent => ({ kind: 'SCAN', cannedImageId });
export const add = (cardId: string, count = 1): Intent => ({ kind: 'ADD', cardId, count });
export const remove = (cardId: string, count = 1): Intent => ({ kind: 'REMOVE', cardId, count });
export const search = (query: string): Intent => ({ kind: 'SEARCH', query });
/** Phase 2: the grounded agent. Carried now so the debug panel shape is fixed. */
export const ask = (prompt: string): Intent => ({ kind: 'ASK', prompt });
export const more = (): Intent => ({ kind: 'MORE' });
export const autoRunes = (): Intent => ({ kind: 'AUTO_RUNES' });
export const sort = (): Intent => ({ kind: 'SORT' });
export const toggleAi = (): Intent => ({ kind: 'TOGGLE_AI' });
export const clear = (): Intent => ({ kind: 'CLEAR' });
export const pick = (ordinal: number): Intent => ({ kind: 'PICK', ordinal });
export const exportDeck = (): Intent => ({ kind: 'EXPORT' });
export const scroll = (rows: number): Intent => ({ kind: 'SCROLL', rows });
export const showOwned = (): Intent => ({ kind: 'SHOW_OWNED' });
export const findStores = (): Intent => ({ kind: 'FIND_STORES' });
export const saveDeck = (): Intent => ({ kind: 'SAVE_DECK' });
export const sideboard = (cardId: string): Intent => ({ kind: 'SIDEBOARD', cardId });
export const priceCard = (cardId: string): Intent => ({ kind: 'PRICE_CARD', cardId });
export const openDeck = (deckId: string): Intent => ({ kind: 'OPEN_DECK', deckId });
export const newDeck = (): Intent => ({ kind: 'NEW_DECK' });
export const toggleOwned = (cardId: string): Intent => ({ kind: 'TOGGLE_OWNED', cardId });
export const focus = (cardId: string | null): Intent => ({ kind: 'FOCUS', cardId });
export const select = (cardId: string | null): Intent => ({ kind: 'SELECT', cardId });
export const next = (): Intent => ({ kind: 'NEXT' });
export const recenter = (): Intent => ({ kind: 'RECENTER' });

export function describeIntent(intent: Intent): string {
  switch (intent.kind) {
    case 'ADD': return `ADD ${intent.count}x ${intent.cardId}`;
    case 'REMOVE': return `REMOVE ${intent.count}x ${intent.cardId}`;
    case 'SEARCH': return `SEARCH "${intent.query}"`;
    case 'ASK': return `ASK "${intent.prompt}"`;
    case 'PICK': return `PICK #${intent.ordinal}`;
    case 'SCROLL': return `SCROLL ${intent.rows > 0 ? '+' : ''}${intent.rows}`;
    case 'FOCUS': return `FOCUS ${intent.cardId ?? '(none)'}`;
    case 'SELECT': return `SELECT ${intent.cardId ?? '(none)'}`;
    case 'SCAN': return `SCAN ${intent.cannedImageId ?? '(live)'}`;
    default: return intent.kind;
  }
}
