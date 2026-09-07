import { test, assert, assertEqual } from './harness.mjs';
import { parseVisionResponse, isBlankTranscription, VISION_PROMPT } from './.build/VisionPrompt.ts';

test('the prompt forbids identification and demands nulls for unreadable fields', () => {
  const lower = VISION_PROMPT.toLowerCase();
  assert(lower.indexOf('do not identify it') !== -1, VISION_PROMPT);
  assert(lower.indexOf('knowledge of the game') !== -1);
  assert(lower.indexOf('null') !== -1);
});

test('a clean reply parses', () => {
  const t = parseVisionResponse('{"name":"Bewitching Spirit","collectorNumber":"121","setCode":"UNL"}');
  assertEqual(t.name, 'Bewitching Spirit');
  assertEqual(t.collectorNumber, '121');
  assertEqual(t.setCode, 'UNL');
});

test('a fractional collector number is reduced to the printing part', () => {
  assertEqual(parseVisionResponse('{"name":"X","collectorNumber":"121/221","setCode":"UNL"}').collectorNumber, '121');
  // Variant markers must survive the split.
  assertEqual(parseVisionResponse('{"name":"X","collectorNumber":"116a/221"}').collectorNumber, '116a');
});

test('fenced JSON wrapped in prose still parses', () => {
  const raw = 'Here is what I can read:\n```json\n{"name":"Vi","collectorNumber":null,"setCode":"UNL"}\n```';
  const t = parseVisionResponse(raw);
  assertEqual(t.name, 'Vi');
  assertEqual(t.collectorNumber, null);
});

test('unreadable fields become null in every form the model uses', () => {
  const t = parseVisionResponse('{"name":"  ","collectorNumber":"null","setCode":"?"}');
  assert(isBlankTranscription(t), JSON.stringify(t));
});

test('a truncated or garbage reply yields a blank transcription, never a throw', () => {
  for (const raw of ['', 'I cannot read this card.', '{"name":"Partial', '{']) {
    const t = parseVisionResponse(raw);
    assert(t.name === null || typeof t.name === 'string', raw);
  }
  assert(isBlankTranscription(parseVisionResponse('nothing here')));
});

test('non-string fields are rejected rather than coerced', () => {
  const t = parseVisionResponse('{"name":123,"collectorNumber":{"a":1},"setCode":true}');
  assert(isBlankTranscription(t));
});
