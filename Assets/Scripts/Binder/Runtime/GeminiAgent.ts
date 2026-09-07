// Binder — Gemini call. Lens runtime. All grounding lives in Core/AgentPrompt.
//
// This file does one thing: send a prompt and hand back raw text. It knows
// nothing about cards, which is deliberate — the candidate set and the
// hallucination guard are pure and tested, and must not depend on the network.

import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/Gemini';

/**
 * Known-good id through the RSG gateway. Many -exp / -preview ids 404 here even
 * though they exist in Google's own API, so do not "upgrade" this casually.
 */
export const GEMINI_MODEL = 'gemini-2.5-flash';

export class GeminiAgent {
  private inFlight = false;

  /** True while a request is outstanding — the UI uses this to avoid stacking asks. */
  isBusy(): boolean {
    return this.inFlight;
  }

  ask(prompt: string, onText: (text: string) => void, onError: (message: string) => void): void {
    if (this.inFlight) {
      onError('still thinking about the last question');
      return;
    }
    this.inFlight = true;

    Gemini.models({
      model: GEMINI_MODEL,
      type: 'generateContent',
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          // Gemini 2.5 THINKS by default, and the thinking is what took this
          // call to ~30 seconds — right on the gateway's deadline, so the ask
          // failed with "Deadline Exceeded" about half the time and returned
          // an empty body the rest. Binder's answers are a ranked pick from a
          // list it was handed; there is nothing here worth thirty seconds of
          // deliberation.
          thinkingConfig: { thinkingBudget: 0 },
          // The reply is a short JSON object. Left uncapped, a model that
          // starts rambling holds the request open until the deadline.
          maxOutputTokens: 800,
          temperature: 0.2,
        },
      },
    })
      .then((response: any) => {
        this.inFlight = false;
        const parts = response?.candidates?.[0]?.content?.parts ?? [];
        const text = parts.map((p: any) => p?.text ?? '').join('');
        if (text.trim() === '') onError('empty response from the model');
        else onText(text);
      })
      .catch((error: any) => {
        this.inFlight = false;
        onError(String(error));
      });
  }
}
