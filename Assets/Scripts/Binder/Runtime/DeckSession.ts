// Binder — two people, one deck. Lens runtime.
//
// The shape, and why:
//
//   The DECK is state.  One person owns the store and writes the whole deck to
//   a StorageProperty. Everybody else receives it, including somebody who joins
//   ten minutes late — a StorageProperty replays to a joiner, so they open
//   their eyes and the deck is simply there.
//
//   An EDIT is a signal.  A person who does not own the store cannot write to
//   it (SyncKit drops the write in silence), so their edit travels as a small
//   message to whoever does. The owner applies it and the new deck replicates
//   back. That is the Scoreboard pattern from the SyncKit guide: one writer,
//   everybody else asks.
//
// What is deliberately NOT shared: where you are scrolled, what you have
// focused, what you asked the assistant. BINDER.md wants the deck argued over,
// not the cursor fought over — and an intent arriving from a peer is dispatched
// into the same reducer as a local button press, so the whitelist in DeckWire
// is what stops somebody else's session spending your Gemini quota.
//
// The wire format and the whitelist live in Core/DeckWire.ts and are pure. This
// file is only the plumbing that carries them.

import type { Deck } from '../Core/Types';
import type { Intent } from '../Core/Intents';
import { serialiseDeck, parseDeckWire, encodeIntent, decodeIntent, isShareable } from '../Core/DeckWire';

import { SessionController } from 'SpectaclesSyncKit.lspkg/Core/SessionController';
import { SyncEntity } from 'SpectaclesSyncKit.lspkg/Core/SyncEntity';
import { StorageProperty } from 'SpectaclesSyncKit.lspkg/Core/StorageProperty';
import { StoragePropertySet } from 'SpectaclesSyncKit.lspkg/Core/StoragePropertySet';
import { StorageTypes } from 'SpectaclesSyncKit.lspkg/Core/StorageTypes';
import { NetworkIdOptions } from 'SpectaclesSyncKit.lspkg/Core/NetworkIdTools';
import { NetworkIdType } from 'SpectaclesSyncKit.lspkg/Core/NetworkIdType';

const TAG = '[Binder][session]';

/**
 * Every client must agree on WHICH entity carries the deck. The default id is
 * derived from the component instance and so differs between devices — two
 * peers would each end up talking to their own private entity and neither
 * would ever see the other. Pinning the id is what makes them one deck.
 */
const DECK_ENTITY_ID = 'BinderSharedDeck';
const EDIT_EVENT = 'binder-edit';

export interface DeckSessionCallbacks {
  /** A deck arrived from the other person. Adopt it; do not publish it back. */
  onDeckArrived: (deck: Deck) => void;
  /** Something worth putting on the assistant panel. */
  onStatus: (message: string) => void;
}

export class DeckSession {
  private syncEntity: SyncEntity | null = null;
  private readonly deckProp: StorageProperty<StorageTypes.string>
    = StorageProperty.manualString('deck', '');
  private started = false;
  private ready = false;

  constructor(
    private readonly component: ScriptComponent,
    private readonly callbacks: DeckSessionCallbacks,
  ) {}

  /** True once the session is connected and the deck entity is live. */
  isReady(): boolean {
    return this.ready;
  }

  /** True when this device is the one holding the pen. */
  isOwner(): boolean {
    return this.syncEntity !== null && this.syncEntity.doIOwnStore();
  }

  /**
   * Open a shared session. Safe to call twice — the second press should not
   * start a second session, and a person who taps a menu row twice is not
   * making a request to do so.
   */
  start(): void {
    if (this.started) {
      this.callbacks.onStatus(this.ready ? 'Already sharing this deck.' : 'Still connecting…');
      return;
    }
    this.started = true;
    this.callbacks.onStatus('Connecting… look around so the room can be mapped.');
    console.log(`${TAG} starting`);

    const session = SessionController.getInstance();
    // startMultiplayer rather than the SyncKit start menu: Binder has its own
    // menu, and stacking a second one in front of it would mean choosing
    // "solo" every time you open the app to build a deck alone.
    session.startMultiplayer();
    session.notifyOnReady(() => this.onSessionReady());
  }

  private onSessionReady(): void {
    console.log(`${TAG} session ready`);
    const idOptions = new NetworkIdOptions(NetworkIdType.Custom, DECK_ENTITY_ID);
    const entity = new SyncEntity(
      this.component, new StoragePropertySet([this.deckProp]), true, 'Session', idOptions,
    );
    this.syncEntity = entity;

    entity.notifyOnReady(() => this.onEntityReady());

    // Subscribing is safe before ready; the edits only start once somebody
    // is connected to send them.
    entity.onEventReceived.add(EDIT_EVENT, (message: { data?: unknown }) => {
      this.onEditReceived(message);
    });
  }

  private onEntityReady(): void {
    this.ready = true;
    const entity = this.syncEntity;
    if (entity === null) return;

    // A joiner's currentValue may not have replicated yet, so read the pending
    // one too — that is the documented shape for reading inside notifyOnReady.
    const held = this.deckProp.currentOrPendingValue;
    if (typeof held === 'string' && held.length > 0) {
      const deck = parseDeckWire(held);
      if (deck !== null) {
        console.log(`${TAG} adopting the deck already in the session`);
        this.callbacks.onDeckArrived(deck);
      }
    }

    // onRemoteChange, not onAnyChange: the owner writes this property itself
    // and must not then adopt its own write back over the top of the deck it
    // is holding.
    this.deckProp.onRemoteChange.add((value: string) => {
      const deck = parseDeckWire(value);
      if (deck === null) {
        console.log(`${TAG} ignored an unreadable deck from the other person`);
        return;
      }
      this.callbacks.onDeckArrived(deck);
    });

    this.callbacks.onStatus(
      entity.doIOwnStore()
        ? 'Sharing this deck. Edits from the other person land here.'
        : 'Joined a shared deck. Your edits go to whoever started it.',
    );
    console.log(`${TAG} ready, owner=${entity.doIOwnStore()}`);
  }

  /**
   * Publish the deck. Only the owner may — for anybody else SyncKit would drop
   * the write without a word, so saying nothing here is the honest behaviour
   * rather than a silent failure.
   */
  publish(deck: Deck): void {
    if (!this.ready || !this.isOwner()) return;
    this.deckProp.setPendingValue(serialiseDeck(deck));
  }

  /**
   * Hand one edit to the owner. Returns true when it was sent.
   *
   * False means "you are on your own": no session, you already own the deck
   * (so apply it locally), or the edit is not one that may travel.
   */
  submit(intent: Intent): boolean {
    if (!this.ready || this.syncEntity === null) return false;
    if (this.isOwner()) return false;
    if (!isShareable(intent)) return false;

    const payload = encodeIntent(intent);
    if (payload === null) {
      console.log(`${TAG} refused to send an oversized edit`);
      return false;
    }
    // remoteOnly: a broadcast is delivered to the sender's own listener too,
    // synchronously. We would ignore it below anyway, but not sending it at
    // all is cheaper and keeps the call stack shallow.
    this.syncEntity.sendEvent(EDIT_EVENT, { payload }, true);
    return true;
  }

  /** An edit arrived from somebody else. Only the owner may act on it. */
  private onEditReceived(message: { data?: unknown }): void {
    if (!this.isOwner()) return;
    const data = message.data as { payload?: unknown } | undefined;
    if (data === undefined || data === null) return;

    const intent = decodeIntent(data.payload);
    if (intent === null) {
      // Either malformed, or an intent a peer is not allowed to ask for.
      console.log(`${TAG} rejected an edit from the other person`);
      return;
    }
    console.log(`${TAG} applying ${intent.kind} from the other person`);
    this.callbacks.onStatus(`They ${intent.kind === 'REMOVE' ? 'removed' : 'changed'} a card.`);
    this.onEdit(intent);
  }

  /** Set by BinderApp — where a peer's edit goes to be applied. */
  onEdit: (intent: Intent) => void = () => {};
}
