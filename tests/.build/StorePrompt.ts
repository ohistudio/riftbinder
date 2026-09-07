// Binder — asking about nearby game shops. Pure, no Lens Studio runtime.
//
// IMPORTANT, and the reason this file reads the way it does: there is no places
// API wired into this project. A language model asked "what shops are near me"
// will happily invent names, streets and phone numbers, and a made-up shop in
// something called a "store finder" sends a real person to a real address that
// is not there.
//
// So: the model is asked for shops it actually recognises, told to return
// nothing rather than guess, and forbidden from inventing street addresses or
// phone numbers. Everything that comes back is labelled unverified by the view.
// This is a lead, not a directory.

export interface StoreSuggestion {
  name: string;
  /** Rough area only — never a street address, which is what gets invented. */
  area: string;
}

export function buildStorePrompt(latitude: number, longitude: number): string {
  return [
    'You help someone find shops that sell trading card games.',
    `They are near latitude ${latitude.toFixed(3)}, longitude ${longitude.toFixed(3)}.`,
    '',
    'Name only shops you genuinely recognise as existing in that area.',
    'Do NOT invent shops. Do NOT invent street addresses or phone numbers.',
    'If you do not confidently know any, return an empty list — that is a fine',
    'answer and far better than a plausible guess.',
    '',
    'Reply with JSON only:',
    '{"stores":[{"name":"...","area":"neighbourhood or town"}]}',
  ].join('\n');
}

/** Pull the suggestions out of a model reply, dropping anything malformed. */
export function parseStoreResponse(text: string): StoreSuggestion[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];

  let parsed: any;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return [];
  }

  const raw = parsed?.stores;
  if (!Array.isArray(raw)) return [];

  const out: StoreSuggestion[] = [];
  for (const entry of raw) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    const area = typeof entry?.area === 'string' ? entry.area.trim() : '';
    if (name.length === 0) continue;
    out.push({ name, area });
  }
  return out;
}
