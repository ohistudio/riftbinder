// Binder — nearby game shops. Lens runtime.
//
// Reads the device's real location, then asks the model for shops it actually
// recognises there. Every result is labelled unverified, because without a
// places API these are leads to check rather than a directory to trust. See
// Core/StorePrompt.ts for why that matters.

import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/Gemini';
import { Config } from '../Core/Config';
import type { StoreSuggestion } from '../Core/StorePrompt';
import { buildStorePrompt, parseStoreResponse } from '../Core/StorePrompt';
import { makeLabel } from './ViewUtils';
import { makeCanvas, makeBackPlate } from './UIKitUtils';
import { GEMINI_MODEL } from './GeminiAgent';

const TAG = '[Binder][stores]';
const MAX_ROWS = 5;

export class StoreFinderView {
  private readonly status: Text | null;
  private readonly rows: Text[] = [];
  private readonly caveat: Text | null;
  private location: LocationService | null = null;
  private busy = false;

  constructor(
    root: SceneObject,
    mesh: RenderMesh,
    materialTemplate: Material,
    font: Font | null,
    widthCm: number,
    heightCm: number,
  ) {
    makeCanvas(root);
    makeBackPlate(root, widthCm, heightCm);

    if (font === null) { this.status = null; this.caveat = null; return; }

    const title = makeLabel(root, font, {
      name: 'Stores Title', xCm: 0, yCm: heightCm / 2 - 7, zCm: 0.2,
      widthCm: widthCm * 0.9, heightCm: 8, role: 'Title2', shrink: false,
    });
    title.text = 'Find a store';

    this.status = makeLabel(root, font, {
      name: 'Stores Status', xCm: 0, yCm: heightCm / 2 - 16, zCm: 0.2,
      widthCm: widthCm * 0.9, heightCm: 6, role: 'Body', tone: 'secondary',
    });
    this.status.text = 'Tap "Find stores" to look near you.';

    for (let i = 0; i < MAX_ROWS; i++) {
      const row = makeLabel(root, font, {
        name: `Store ${i}`, xCm: 0, yCm: heightCm / 2 - 25 - i * 7, zCm: 0.2,
        widthCm: widthCm * 0.9, heightCm: 6, role: 'Headline2',
      });
      row.text = '';
      this.rows.push(row);
    }

    this.caveat = makeLabel(root, font, {
      name: 'Stores Caveat', xCm: 0, yCm: -heightCm / 2 + 8, zCm: 0.2,
      widthCm: widthCm * 0.9, heightCm: 8, role: 'Caption', tone: 'tertiary',
    });
    this.caveat.horizontalOverflow = HorizontalOverflow.Wrap;
    this.caveat.text = '';
  }

  /** Ask where we are, then ask what is nearby. */
  find(): void {
    if (this.busy) return;
    this.setStatus('Finding your location…');
    this.clearRows();

    try {
      if (this.location === null) this.location = GeoLocation.createLocationService();
      this.location.accuracy = GeoLocationAccuracy.Navigation;
    } catch (e) {
      this.setStatus(`Location unavailable: ${e}`);
      return;
    }

    this.busy = true;
    this.location.getCurrentPosition(
      (position) => this.ask(position.latitude, position.longitude),
      (error) => { this.busy = false; this.setStatus(`Could not get your location: ${error}`); },
    );
  }

  private ask(latitude: number, longitude: number): void {
    this.setStatus('Looking for shops nearby…');
    console.log(`${TAG} asking near ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`);

    Gemini.models({
      model: GEMINI_MODEL,
      type: 'generateContent',
      body: {
        contents: [{ role: 'user', parts: [{ text: buildStorePrompt(latitude, longitude) }] }],
      },
    })
      .then((response: any) => {
        this.busy = false;
        const parts = response?.candidates?.[0]?.content?.parts ?? [];
        const text = parts.map((p: any) => p?.text ?? '').join('');
        this.show(parseStoreResponse(text));
      })
      .catch((error: any) => {
        this.busy = false;
        this.setStatus(`Could not look that up: ${error}`);
      });
  }

  private show(stores: StoreSuggestion[]): void {
    this.clearRows();
    if (stores.length === 0) {
      // An empty answer is the honest one when the model does not know the
      // area, and it is what the prompt asks for. Do not dress it up.
      this.setStatus('No shops I can vouch for near you.');
      if (this.caveat !== null) {
        this.caveat.text = 'Binder has no shop directory — it can only pass on places '
          + 'the assistant already recognises.';
      }
      return;
    }

    this.setStatus(`${stores.length} possible shop${stores.length === 1 ? '' : 's'}:`);
    stores.slice(0, MAX_ROWS).forEach((store, i) => {
      this.rows[i].text = store.area.length > 0 ? `${store.name}  ·  ${store.area}` : store.name;
    });
    if (this.caveat !== null) {
      this.caveat.text = 'Unverified — these come from the assistant, not a shop '
        + 'directory. Check one is open before travelling.';
    }
  }

  private clearRows(): void {
    for (const row of this.rows) row.text = '';
    if (this.caveat !== null) this.caveat.text = '';
  }

  private setStatus(message: string): void {
    if (this.status !== null) this.status.text = message;
    console.log(`${TAG} ${message}`);
  }
}
