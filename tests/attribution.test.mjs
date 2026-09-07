import { test, assert, assertEqual } from './harness.mjs';
import { RIOT_LEGAL_NOTICE, PROJECT_TITLE } from './.build/Attribution.ts';
import { readFileSync } from 'node:fs';

// Riot's policy requires this sentence VERBATIM, with the project title
// substituted in. It is a legal string, not copy — so it is pinned here rather
// than trusted to survive a tidy-up.
const REQUIRED =
  'RiftBinder was created under Riot Games\' "Legal Jibber Jabber" policy using '
  + 'assets owned by Riot Games. Riot Games does not endorse or sponsor this project.';

test('the Riot notice is exactly the required wording', () => {
  assertEqual(RIOT_LEGAL_NOTICE, REQUIRED);
});

test('the project title is substituted into the notice', () => {
  assertEqual(PROJECT_TITLE, 'RiftBinder');
  assert(RIOT_LEGAL_NOTICE.indexOf(PROJECT_TITLE) === 0, 'the title opens the sentence');
});

test('README quotes the notice verbatim, so the two cannot drift', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert(readme.indexOf(RIOT_LEGAL_NOTICE) !== -1,
    'README.md must contain the notice character for character');
});

test('the Lens actually renders it — a constant nobody imports is not attribution', () => {
  // This is the failure that already happened once: the notice existed, the
  // document said it was shown, and no runtime file referenced it.
  const menu = readFileSync(
    new URL('../Assets/Scripts/Binder/Runtime/MainMenuView.ts', import.meta.url), 'utf8');
  assert(menu.indexOf('RIOT_LEGAL_NOTICE') !== -1,
    'the main menu must render the notice');
});
