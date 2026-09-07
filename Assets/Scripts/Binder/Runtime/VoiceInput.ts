// Binder — speech to intents. Lens runtime.
//
// DEVICE ONLY. ASR does not run in Lens Studio Preview — it returns nothing
// there regardless of wiring, so this path cannot be verified on a desktop.
// That is exactly why BINDER.md § Interaction insists the tap debug panel fires
// every intent with identical payloads: the demo must survive voice failing.
//
// Parsing lives in Core/Utterance.ts and is pure and tested. This file only
// moves audio to text and hands the text over.

import type { Intent } from '../Core/Intents';
import { parseUtterance } from '../Core/Utterance';

const TAG = '[Binder][voice]';

export class VoiceInput {
  private readonly asr: AsrModule = require('LensStudio:AsrModule');
  private listening = false;
  private lastTranscript = '';

  constructor(
    private readonly dispatch: (intent: Intent) => void,
    private readonly focusedCardId: () => string | null,
    private readonly onStatus: (message: string) => void,
  ) {}

  isListening(): boolean {
    return this.listening;
  }

  /** Hold-to-talk: call on press. Safe to call twice. */
  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.lastTranscript = '';
    this.onStatus('Listening… (release to stop)');

    const options = AsrModule.AsrTranscriptionOptions.create();
    options.silenceUntilTerminationMs = 1500;
    options.mode = AsrModule.AsrMode.HighAccuracy;

    // Partials are written straight to the status line: if the user cannot see
    // their words appearing, they have no way to tell ASR from a dead mic.
    options.onTranscriptionUpdateEvent.add((event: AsrModule.TranscriptionUpdateEvent) => {
      if (event.text) {
        this.lastTranscript = event.text;
        this.onStatus(`“${event.text}”`);
      }
      console.log(`${TAG} partial="${event.text}" final=${event.isFinal}`);
      if (event.isFinal) this.commit();
    });

    // Surface the code verbatim — Unauthenticated, NoInternet and InternalError
    // each need a different fix and must not collapse into "voice failed".
    options.onTranscriptionErrorEvent.add((code: AsrModule.AsrStatusCode) => {
      console.warn(`${TAG} error code=${code}`);
      this.onStatus(`Voice error: ${code}`);
      this.listening = false;
    });

    try {
      this.asr.startTranscribing(options);
      console.log(`${TAG} startTranscribing called`);
    } catch (e) {
      console.warn(`${TAG} start threw: ${e}`);
      this.onStatus(`Voice error: ${e}`);
      this.listening = false;
    }
  }

  /** Hold-to-talk: call on release. */
  stop(): void {
    if (!this.listening) return;
    this.listening = false;
    this.asr.stopTranscribing().then(() => {
      console.log(`${TAG} stopped`);
      this.commit();
    });
  }

  private commit(): void {
    const transcript = this.lastTranscript.trim();
    this.lastTranscript = '';
    if (transcript === '') { this.onStatus('Nothing heard.'); return; }

    const intent = parseUtterance(transcript, this.focusedCardId());
    if (intent === null) {
      // The usual cause is "add three" with nothing gazed.
      this.onStatus(`Heard “${transcript}” — gaze a card first.`);
      console.log(`${TAG} unroutable: "${transcript}"`);
      return;
    }
    this.dispatch(intent);
  }
}
