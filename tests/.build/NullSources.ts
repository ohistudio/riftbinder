// Binder — deferred data sources, v1 null implementations.
//
// Prices and metagame stats are deferred, not forbidden (BINDER.md § Non-goals).
// Every method returns null and the UI hides the corresponding field entirely.
// Neither source may ever influence deck validation.

import type { PriceSource, StatsSource } from './Types.ts';

export class NullPriceSource implements PriceSource {
  forPrinting(_cardId: string): { amount: number; currency: string; asOf: number } | null {
    return null;
  }
  attribution(): string | null {
    return null;
  }
}

export class NullStatsSource implements StatsSource {
  forCard(_cardId: string): { playRate?: number; asOf: number } | null {
    return null;
  }
  attribution(): string | null {
    return null;
  }
}
