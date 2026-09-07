// Binder — CardSource over an in-memory card array.
//
// Deliberately knows nothing about where the cards came from: it backs the
// generated Riftcodex catalogue today and will back a Riot API response
// unchanged. Swapping source means changing one construction site in BinderApp
// and nothing else (BINDER.md § Hard IP constraints).

import type { Card, CardSource } from './Types';
import { normalizeName, similarity } from './Matching';

export class MemoryCardSource implements CardSource {
  private readonly cards: Card[];
  private readonly byIdIndex: Map<string, Card>;
  private readonly normalizedNames: Map<string, string>;

  constructor(cards: readonly Card[]) {
    this.cards = cards.slice();
    this.byIdIndex = new Map();
    this.normalizedNames = new Map();
    for (const card of this.cards) {
      this.byIdIndex.set(card.id, card);
      this.normalizedNames.set(card.id, normalizeName(card.name));
    }
  }

  all(): Card[] {
    return this.cards.slice();
  }

  byId(id: string): Card | null {
    const found = this.byIdIndex.get(id);
    return found === undefined ? null : found;
  }

  search(query: string, limit: number): { card: Card; score: number }[] {
    const q = normalizeName(query);
    const scored = this.cards.map((card) => ({
      card,
      score: similarity(q, this.normalizedNames.get(card.id) as string),
    }));
    scored.sort((a, b) => (b.score - a.score) || (a.card.name.length - b.card.name.length));
    return limit >= 0 ? scored.slice(0, limit) : scored;
  }
}
