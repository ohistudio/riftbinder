// Binder — the shelf of saved decks. Lens runtime.
//
// One row per deck: its name, what it is, and a button that opens it. Saving is
// a button on the deck screen, not something that happens silently — a deck
// that saves itself is a deck you cannot experiment with.

import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button';
import type { Deck } from '../Core/Types';
import type { DeckLibrary } from '../Core/DeckLibrary';
import { describeDeck } from '../Core/DeckLibrary';
import {
  makeCanvas, makeBackPlate, makeObject, makeText, addButtonRim, tintButtonFill, feelPress, BUTTON_LABEL_Z,
} from './UIKitUtils';

const ROW_HEIGHT_CM = 13;
const ROW_GAP_CM = 2.2;
const MAX_ROWS = 5;

interface Row {
  root: SceneObject;
  name: Text;
  detail: Text;
  deckId: string | null;
}

export class DeckLibraryView {
  private readonly rows: Row[] = [];
  private readonly status: Text;
  private onOpenDeck: (deckId: string) => void = () => {};

  constructor(
    root: SceneObject,
    private readonly font: Font | null,
    private readonly widthCm: number,
    heightCm: number,
  ) {
    makeCanvas(root);
    makeBackPlate(root, widthCm, heightCm);
    const content = makeObject(root, 'Content', new vec3(0, 0, 0.6));

    makeText(makeObject(content, 'Title', new vec3(0, heightCm / 2 - 6, 0.2)),
      font, 'Text', 'Your decks', { role: 'Title2', widthCm: widthCm - 6 });

    this.status = makeText(
      makeObject(content, 'Status', new vec3(0, heightCm / 2 - 14, 0.2)),
      font, 'Text', '', { role: 'Body', tone: 'secondary', widthCm: widthCm - 8 });

    const top = heightCm / 2 - 22;
    for (let i = 0; i < MAX_ROWS; i++) {
      this.rows.push(this.buildRow(content, top - i * (ROW_HEIGHT_CM + ROW_GAP_CM)));
    }
  }

  onOpen(handler: (deckId: string) => void): void { this.onOpenDeck = handler; }

  render(library: DeckLibrary, byId: (cardId: string) => { name: string } | null): void {
    const decks = library.decks;
    this.status.text = decks.length === 0
      ? 'Nothing saved yet — build a deck and press Save deck.'
      : `${decks.length} saved`;

    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      const deck: Deck | undefined = decks[i];
      const shown = deck !== undefined;
      row.root.enabled = shown;
      if (!shown) { row.deckId = null; continue; }
      row.deckId = deck.id;
      row.name.text = deck.name.length > 0 ? deck.name : 'Untitled deck';
      row.detail.text = describeDeck(deck, byId);
    }

    if (decks.length > MAX_ROWS) {
      this.status.text = `${decks.length} saved — showing the ${MAX_ROWS} most recent`;
    }
  }

  private buildRow(parent: SceneObject, yCm: number): Row {
    const root = makeObject(parent, 'Deck Row', new vec3(0, yCm, 0.1));
    const width = this.widthCm - 10;

    const button = root.createComponent(Button.getTypeName()) as Button;
    button.size = new vec3(width, ROW_HEIGHT_CM, 1);
    addButtonRim(root, width, ROW_HEIGHT_CM);
    tintButtonFill(button);
    feelPress(button, root);

    const name = makeText(makeObject(root, 'Name', new vec3(0, 2.2, BUTTON_LABEL_Z)),
      this.font, 'Text', '', { role: 'Headline2', widthCm: width - 3, shrink: true });
    const detail = makeText(makeObject(root, 'Detail', new vec3(0, -2.8, BUTTON_LABEL_Z)),
      this.font, 'Text', '', {
        role: 'Caption', tone: 'secondary', widthCm: width - 3, shrink: true,
      });

    const row: Row = { root, name, detail, deckId: null };
    button.onTriggerUp.add(() => {
      if (row.deckId !== null) this.onOpenDeck(row.deckId);
    });
    root.enabled = false;
    return row;
  }
}
