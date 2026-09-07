import { test, assert, assertEqual, assertDeep } from './harness.mjs';
import { TrackerRegistry } from './.build/Trackers.ts';

const MIN_AGE = 200;
const TTL = 1000;

test('a new tracker starts unidentified', () => {
  const r = new TrackerRegistry();
  const b = r.observe('t1', 1000);
  assertEqual(b.cardId, null);
  assertEqual(b.identifying, false);
  assertEqual(r.size(), 1);
});

test('observing the same tracker again refreshes rather than duplicating', () => {
  const r = new TrackerRegistry();
  r.observe('t1', 1000);
  const again = r.observe('t1', 1500);
  assertEqual(r.size(), 1);
  assertEqual(again.firstSeenAt, 1000, 'first sighting must not move');
  assertEqual(again.lastSeenAt, 1500);
});

test('identification is only requested after the tracker has been stable', () => {
  const r = new TrackerRegistry();
  r.observe('t1', 1000);
  assertEqual(r.pendingIdentification(1000 + MIN_AGE - 1, MIN_AGE).length, 0,
    'a one-frame flicker must not cost a vision call');
  assertEqual(r.pendingIdentification(1000 + MIN_AGE, MIN_AGE).length, 1);
});

test('a tracker being identified is not asked for twice', () => {
  const r = new TrackerRegistry();
  r.observe('t1', 1000);
  assertEqual(r.pendingIdentification(2000, MIN_AGE).length, 1);
  r.markIdentifying('t1');
  assertEqual(r.pendingIdentification(2000, MIN_AGE).length, 0);
});

test('binding attaches identity and stops it being re-requested', () => {
  const r = new TrackerRegistry();
  r.observe('t1', 1000);
  r.markIdentifying('t1');
  r.bind('t1', 'unl-121-219', 1200);
  assertEqual(r.cardFor('t1'), 'unl-121-219');
  assertEqual(r.pendingIdentification(3000, MIN_AGE).length, 0);
});

test('an unreadable card clears identifying so it can be retried', () => {
  const r = new TrackerRegistry();
  r.observe('t1', 1000);
  r.markIdentifying('t1');
  r.bind('t1', null, 1200);
  assertEqual(r.cardFor('t1'), null);
  assertEqual(r.pendingIdentification(3000, MIN_AGE).length, 1, 'a failed read should be retryable');
});

test('expiry drops stale trackers and reports them for UI teardown', () => {
  const r = new TrackerRegistry();
  r.observe('t1', 1000);
  r.observe('t2', 1000);
  r.observe('t2', 2000);                     // t2 still visible
  const dropped = r.expire(2000 + TTL, TTL);
  assertDeep(dropped, ['t1']);
  assertEqual(r.size(), 1);
  assertEqual(r.get('t1'), null);
});

test('a re-appearing tracker is identified again rather than resurrected', () => {
  const r = new TrackerRegistry();
  r.observe('t1', 1000);
  r.bind('t1', 'unl-121-219', 1100);
  r.expire(5000, TTL);
  r.observe('t1', 6000);
  assertEqual(r.cardFor('t1'), null, 'identity must not survive losing the tracker');
  assertEqual(r.pendingIdentification(6000 + MIN_AGE, MIN_AGE).length, 1);
});

test('binding a tracker that expired mid-flight is a safe no-op', () => {
  const r = new TrackerRegistry();
  r.observe('t1', 1000);
  r.markIdentifying('t1');
  r.expire(5000, TTL);
  r.bind('t1', 'unl-121-219', 5100);
  assertEqual(r.size(), 0);
  assertEqual(r.cardFor('t1'), null);
});

test('several cards in frame are tracked independently', () => {
  const r = new TrackerRegistry();
  r.observeAll(['a', 'b', 'c'], 1000);
  r.bind('b', 'unl-121-219', 1100);
  assertEqual(r.size(), 3);
  assertEqual(r.cardFor('b'), 'unl-121-219');
  assertEqual(r.cardFor('a'), null);
  assertEqual(r.pendingIdentification(2000, MIN_AGE).length, 2, 'only the unidentified ones');
});
