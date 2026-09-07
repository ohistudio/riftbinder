// Binder — which screen you are on. Pure, no Lens Studio runtime.

export type AppMode = 'menu' | 'deck' | 'cards' | 'stores' | 'decks';

export interface MenuItem {
  mode: AppMode;
  label: string;
  blurb: string;
}

/**
 * The main menu. Deck building is no longer where the Lens starts — it is one
 * of three things you might have come here to do.
 */
export const MENU_ITEMS: MenuItem[] = [
  { mode: 'deck',   label: 'Build a deck',  blurb: 'Legend, champion, battlefields, then the rest' },
  { mode: 'cards',  label: 'Your cards',    blurb: 'What you own — add by hand or by camera' },
  { mode: 'decks',  label: 'Your decks',    blurb: 'Open a deck you saved earlier' },
  { mode: 'stores', label: 'Find a store',  blurb: 'Game shops near you' },
];

/**
 * Opening a shared session is an ACTION, not a screen, so it is kept out of
 * MENU_ITEMS rather than given an AppMode it would never use. It sits below
 * the screens because it changes what the other rows do rather than replacing
 * them.
 */
export const SHARE_ITEM = {
  label: 'Play together',
  blurb: 'Build one deck with someone else in the room',
};

/** The panels each screen shows. Everything else is hidden. */
export function panelsFor(mode: AppMode): {
  menu: boolean; browse: boolean; deck: boolean; agent: boolean; focus: boolean;
  stores: boolean; sheet: boolean; decks: boolean;
} {
  return {
    menu: mode === 'menu',
    // The browse panel is the card grid: the deck builder picks from it, and
    // "Your cards" is the same grid filtered to what you own.
    browse: mode === 'deck' || mode === 'cards',
    // The deck WALL is off. It and the sheet were both on for the deck screen,
    // so the deck was drawn twice — once as cards in energy columns and once as
    // the decklist — and you had to work out which one you were looking at. The
    // sheet is the one that carries the Rift Atlas formatting, so it is the one
    // that stays.
    deck: false,
    // The decklist belongs to the deck screen: it is what the building is for.
    sheet: mode === 'deck',
    // The assistant carries status text for both card screens.
    agent: mode === 'deck' || mode === 'cards',
    focus: mode === 'deck' || mode === 'cards',
    stores: mode === 'stores',
    decks: mode === 'decks',
  };
}

export function headingFor(mode: AppMode): string {
  if (mode === 'menu') return 'Menu';
  if (mode === 'cards') return 'Your cards';
  if (mode === 'stores') return 'Find a store';
  if (mode === 'decks') return 'Your decks';
  return 'Build a deck';
}
