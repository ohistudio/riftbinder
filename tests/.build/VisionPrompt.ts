// Binder — card identification prompt and response parsing. Pure.
//
// BINDER.md § Identification step 3: the model TRANSCRIBES, it does not
// identify. It is asked for printed text only, with nulls where unreadable, and
// explicitly told it has no knowledge of the game. Matching that transcription
// to a real card happens locally in Core/Matching.ts against the catalogue.
//
// This split is what stops a confident model from inventing a card that is not
// in the set — the same grounding rule as the suggestion agent, applied to
// vision.

import type { VisionTranscription } from './Types.ts';
import { extractJson } from './AgentPrompt.ts';

export const VISION_PROMPT = [
  'You are reading a single trading card in the image.',
  '',
  'Transcribe ONLY what is printed on the card. Do not identify it, do not use any',
  'knowledge of the game, and do not guess. If a field is not clearly legible, use null.',
  '',
  'Reply with JSON only, no prose, in exactly this shape:',
  '{"name": string|null, "collectorNumber": string|null, "setCode": string|null, "box_2d": [ymin, xmin, ymax, xmax]}',
  '',
  'box_2d is the bounding box of the card itself in the image, as integers from 0',
  'to 1000 (top-left origin). If no card is visible at all, use null for box_2d.',
  '',
  'The collector number is usually small print near the bottom edge, often written',
  'as a number then a slash then a total (for example "121/221"). Return only the',
  'part before the slash, and keep any letter or symbol attached to it.',
  '',
  'The set code is the SHORT ALL-CAPS CODE of two to four letters printed',
  'immediately BEFORE the collector number, on the same line, usually separated',
  'by a dot (for example "UNL · 120/219" gives setCode "UNL"). It is NOT the',
  'artist credit: the artist name is printed separately, often at the bottom',
  'right next to a pen or brush symbol and a copyright line, and may be in any',
  'script. Never report an artist name as the set code. If you cannot find a',
  'short code next to the number, set setCode to null rather than guessing.',
].join('\n');

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed === '?') return null;
  return trimmed;
}

/**
 * Pull a set code out of a collector number that swallowed it.
 *
 * "UNL 120" -> set UNL, number 120. Only fills the set when it is not already
 * known, so an explicitly transcribed set always wins.
 */
export function splitSetFromNumber(
  collector: string | null, setCode: string | null,
): { collectorNumber: string | null; setCode: string | null } {
  if (collector === null) return { collectorNumber: null, setCode };

  // Letters, then a separator, then the digits: "UNL 120", "UNL-120", "UNL•120".
  const match = /^([A-Za-z]{2,5})\s*[-•·:.]?\s*(\d{1,4}[A-Za-z]?)$/.exec(collector.trim());
  if (match === null) return { collectorNumber: collector, setCode };

  return {
    collectorNumber: match[2],
    setCode: setCode !== null ? setCode : match[1].toUpperCase(),
  };
}

/**
 * Parse a vision reply into a transcription. Survives fenced JSON, surrounding
 * prose and truncation via the same extractor the suggestion agent uses. An
 * unparseable reply yields all-nulls rather than throwing — the caller then
 * treats it as an unreadable card and routes it to the unmatched tray.
 */
export function parseVisionResponse(raw: string): VisionTranscription {
  const empty: VisionTranscription = { name: null, collectorNumber: null, setCode: null };
  const json = extractJson(raw);
  if (json === null) return empty;

  let parsed: any;
  try { parsed = JSON.parse(json); } catch (e) { return empty; }
  if (parsed === null || typeof parsed !== 'object') return empty;

  let collector = cleanString(parsed.collectorNumber);
  // Models return "121/221" despite being asked for the left half; take it.
  if (collector !== null && collector.indexOf('/') !== -1) {
    collector = collector.split('/')[0].trim();
    if (collector === '') collector = null;
  }

  // The card prints set and number together ("UNL • 120/219"), and the model
  // hands back the whole run as the number with the set left null. Split it, or
  // the set is thrown away and the number never matches anything.
  const split = splitSetFromNumber(collector, cleanString(parsed.setCode));

  return {
    name: cleanString(parsed.name),
    collectorNumber: split.collectorNumber,
    setCode: split.setCode,
  };
}

/**
 * The card's bounding box from the model's reply, in 0..1000 image-normalised
 * units, or null. Separate from the transcription on purpose: the box is
 * PRESENTATION (where to draw the outline), not identity, and a wrong box must
 * never affect matching.
 *
 * This exists because the local quad detector cannot find a card that fills
 * the frame - which is exactly how people hold a card up to scan it - so the
 * scan preview never had an outline to draw. The model can see the card at any
 * framing.
 */
export function parseVisionBox(raw: string): { x: number; y: number; width: number; height: number; cx: number; cy: number } | null {
  const json = extractJson(raw);
  if (json === null) return null;
  let parsed: any;
  try { parsed = JSON.parse(json); } catch (e) { return null; }
  const b = parsed?.box_2d ?? parsed?.box ?? null;
  if (!Array.isArray(b) || b.length !== 4) return null;
  const nums = b.map((v: any) => typeof v === 'number' ? v : NaN);
  if (nums.some((v: number) => !isFinite(v))) return null;
  // Gemini's convention: [ymin, xmin, ymax, xmax], 0..1000.
  const clamp = (v: number): number => Math.max(0, Math.min(1000, v));
  const yMin = clamp(nums[0]); const xMin = clamp(nums[1]);
  const yMax = clamp(nums[2]); const xMax = clamp(nums[3]);
  const width = xMax - xMin;
  const height = yMax - yMin;
  // A degenerate or frame-swallowing box draws worse than no box.
  if (width < 20 || height < 20 || (width > 980 && height > 980)) return null;
  return { x: xMin, y: yMin, width, height, cx: xMin + width / 2, cy: yMin + height / 2 };
}

/** True when the model read nothing usable at all. */
export function isBlankTranscription(t: VisionTranscription): boolean {
  return t.name === null && t.collectorNumber === null && t.setCode === null;
}
