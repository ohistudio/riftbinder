// Binder — identify a physical card. Lens runtime.
//
// Pipeline (BINDER.md § Identification):
//   texture -> base64 -> Gemini vision (transcribe only) -> local match -> collection
//
// The model never identifies a card; it reads printed text. Matching happens in
// Core/Matching.ts against the real catalogue, so a card that is not in the set
// cannot be invented into existence.
//
// Two entry points on purpose. `scanTexture` takes any texture — the contract
// requires SCAN to accept a canned image so the demo survives a dead camera.
// `scanCamera` grabs a live frame and hands it to the same path.

import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/Gemini';
import type { CardSource, ScanResult } from '../Core/Types';
import { VISION_PROMPT, parseVisionResponse, parseVisionBox, isBlankTranscription } from '../Core/VisionPrompt';
import { matchTranscription, MatchOptions } from '../Core/Matching';
import { GEMINI_MODEL } from './GeminiAgent';

const TAG = '[Binder][scan]';

export class CardScanner {
  private busy = false;
  private cameraTexture: Texture | null = null;
  /** The frame the last scan actually looked at, so it can be shown back. */
  private lastFrame: Texture | null = null;
  private lastReply = '';
  private lastBox: { x: number; y: number; width: number; height: number; cx: number; cy: number } | null = null;

  constructor(
    private readonly source: CardSource,
    private readonly matchOptions: MatchOptions,
    private readonly cameraModule: CameraModule | null,
  ) {}

  isBusy(): boolean {
    return this.busy;
  }

  /** The exact texture sent to the model on the last scan. */
  frame(): Texture | null { return this.lastFrame; }

  /** The model's raw reply from the last scan, for showing back to the user. */
  reply(): string { return this.lastReply; }

  /** Where the model says the card sits in the frame (0..1000 units), or null. */
  box(): { x: number; y: number; width: number; height: number; cx: number; cy: number } | null { return this.lastBox; }

  /**
   * Open the camera early so the first scan has a loaded frame.
   *
   * requestCamera() returns a texture that fills in asynchronously; asking for
   * it and encoding it in the same breath yields "texture isn't loaded".
   */
  /**
   * The live camera frame, once warmUp has opened it.
   *
   * Exposed so the scene capture can put the ROOM behind the Lens content:
   * a render-target camera draws geometry over an empty background, so
   * without this the scan is a card floating in a void.
   */
  liveFrame(): Texture | null { return this.cameraTexture; }

  warmUp(): void {
    if (this.cameraModule === null || this.cameraTexture !== null) return;
    try {
      const request = CameraModule.createCameraRequest();
      this.cameraTexture = this.cameraModule.requestCamera(request);
      console.log(`${TAG} camera opened`);
    } catch (e) {
      console.warn(`${TAG} could not open the camera: ${e}`);
    }
  }

  /**
   * Live camera frame. The texture is requested once and reused — it updates in
   * place, so re-requesting per scan would churn the camera session.
   */
  scanCamera(onResult: (result: ScanResult) => void, onError: (message: string) => void): void {
    if (this.cameraModule === null) { onError('no camera module assigned'); return; }
    try {
      if (this.cameraTexture === null) {
        const request = CameraModule.createCameraRequest();
        this.cameraTexture = this.cameraModule.requestCamera(request);
      }
      this.scanTexture(this.cameraTexture, onResult, onError);
    } catch (e) {
      onError(`camera unavailable: ${e}`);
    }
  }

  scanTexture(
    texture: Texture,
    onResult: (result: ScanResult) => void,
    onError: (message: string) => void,
  ): void {
    if (this.busy) { onError('a scan is already running'); return; }
    this.busy = true;

    this.lastFrame = texture;
    this.lastBox = null;
    Base64.encodeTextureAsync(
      texture,
      (encoded) => {
        // Proof the frame is real and non-empty before blaming the model: a
        // black or unbound texture still encodes, but to a tiny JPEG.
        console.log(`${TAG} sending ${texture.getWidth()}x${texture.getHeight()} frame `
          + `to Gemini — ${Math.round(encoded.length / 1024)} KB of base64 JPEG`);
        this.askVision(encoded, onResult, onError);
      },
      () => { this.busy = false; onError('could not encode the frame'); },
      CompressionQuality.HighQuality,
      EncodingType.Jpg,
    );
  }

  private askVision(
    base64Jpg: string,
    onResult: (result: ScanResult) => void,
    onError: (message: string) => void,
  ): void {
    Gemini.models({
      model: GEMINI_MODEL,
      type: 'generateContent',
      body: {
        contents: [{
          role: 'user',
          parts: [
            { text: VISION_PROMPT },
            { inlineData: { mimeType: 'image/jpeg', data: base64Jpg } },
          ],
        }],
      },
    })
      .then((response: any) => {
        this.busy = false;
        const parts = response?.candidates?.[0]?.content?.parts ?? [];
        const text = parts.map((p: any) => p?.text ?? '').join('');
        const transcription = parseVisionResponse(text);
        console.log(`${TAG} read name=${transcription.name} number=${transcription.collectorNumber} set=${transcription.setCode}`);
        // The model's raw words, kept for the on-panel readout: "read nothing"
        // and "read something we could not match" look identical without it.
        this.lastReply = text.trim();
        this.lastBox = parseVisionBox(text);
        if (this.lastBox !== null) console.log(`${TAG} model box ${Math.round(this.lastBox.width)}x${Math.round(this.lastBox.height)} at ${Math.round(this.lastBox.cx)},${Math.round(this.lastBox.cy)} (0..1000)`);

        if (isBlankTranscription(transcription)) {
          onError('could not read anything on the card');
          return;
        }

        // Identity is decided here, locally, against the real catalogue.
        onResult(matchTranscription(transcription, this.source, this.matchOptions));
      })
      .catch((error: any) => {
        this.busy = false;
        onError(String(error));
      });
  }
}
