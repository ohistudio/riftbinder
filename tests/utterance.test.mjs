import { test, assert, assertEqual } from './harness.mjs';
import { parseUtterance } from './.build/Utterance.ts';

const FOCUS = 'unl-121-219';
const p = (text, focus = FOCUS) => parseUtterance(text, focus);

test('every intent in the contract table has an utterance that reaches it', () => {
  assertEqual(p('scan').kind, 'SCAN');
  assertEqual(p('add').kind, 'ADD');
  assertEqual(p('remove').kind, 'REMOVE');
  assertEqual(p('show me units under four').kind, 'SEARCH');
  assertEqual(p('show everything').kind, 'CLEAR');
  assertEqual(p('the second one').kind, 'PICK');
  assertEqual(p('export').kind, 'EXPORT');
  assertEqual(p('build me a fury aggro deck').kind, 'ASK');
});

test('counts are read from the phrase, defaulting to one', () => {
  assertEqual(p('add three').count, 3);
  assertEqual(p('add').count, 1);
  assertEqual(p('add 2').count, 2);
  assertEqual(p('take one out').count, 1);
  assertEqual(p('remove two').count, 2);
});

test('gaze-dependent intents refuse to guess a target', () => {
  assertEqual(p('add three', null), null, 'ADD without gaze must not pick a card');
  assertEqual(p('remove', null), null);
  // Gaze-independent intents still work with nothing focused.
  assertEqual(p('scan', null).kind, 'SCAN');
  assertEqual(p('show everything', null).kind, 'CLEAR');
});

test('"show everything" clears rather than searching for the word everything', () => {
  assertEqual(p('show everything').kind, 'CLEAR');
  assertEqual(p('show me everything cheap').kind, 'SEARCH');
});

test('ordinals resolve for scan disambiguation', () => {
  assertEqual(p('the first one').ordinal, 1);
  assertEqual(p('the second one').ordinal, 2);
  assertEqual(p('the third one').ordinal, 3);
});

test('anything unrecognised becomes a question for the agent, not an error', () => {
  for (const phrase of ['what goes well with this legend',
                        'i want something that trades up against three drops',
                        'is this deck any good']) {
    const intent = p(phrase);
    assertEqual(intent.kind, 'ASK', phrase);
    assertEqual(intent.prompt, phrase, 'the agent must receive the original wording');
  }
});

test('punctuation, casing and filler do not change the intent', () => {
  assertEqual(p('Add, three!').kind, 'ADD');
  assertEqual(p('  SCAN  ').kind, 'SCAN');
  assertEqual(p(''), null, 'an empty transcript is not an intent');
});

test('search keeps the original wording so the parser sees real casing', () => {
  assertEqual(p('only Fury').query, 'only Fury');
});

test('scrolling is reachable by voice', () => {
  assert(p('next page').rows > 0);
  assert(p('scroll down').rows > 0);
  assert(p('scroll up').rows < 0);
});
