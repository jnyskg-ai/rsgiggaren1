import assert from 'node:assert/strict';
import test from 'node:test';
import { hookToken, isAllowedOrigin, normalizeAlarmRequest } from '../src/validation.mjs';

const now = 1_800_000_000_000;
const subscription = {
  endpoint: 'https://web.push.apple.com/QPUSH_TOKEN',
  keys: {
    p256dh: 'BCx2_Some-valid-p256dh-key_1234567890',
    auth: 'Some_auth-key_1234'
  }
};

test('godkänner och normaliserar ett iPhone-vilotlarm', () => {
  const result = normalizeAlarmRequest({
    action: 'schedule',
    timerId: '550e8400-e29b-41d4-a716-446655440000',
    endAt: now + 90_000,
    exercise: '  Bänkpress\n ',
    subscription
  }, now);
  assert.equal(result.action, 'schedule');
  assert.equal(result.exercise, 'Bänkpress');
  assert.equal(result.subscription.endpoint, subscription.endpoint);
  assert.equal(hookToken(result.timerId), 'rsg-rest:550e8400-e29b-41d4-a716-446655440000');
});

test('tillåter förlängning och stopp utan att skicka prenumerationen igen', () => {
  const rescheduled = normalizeAlarmRequest({
    action: 'reschedule',
    timerId: '550e8400-e29b-41d4-a716-446655440000',
    endAt: now + 120_000,
    exercise: 'Knäböj'
  }, now);
  const cancelled = normalizeAlarmRequest({
    action: 'cancel',
    timerId: '550e8400-e29b-41d4-a716-446655440000'
  }, now);
  assert.equal(rescheduled.action, 'reschedule');
  assert.deepEqual(cancelled, { action: 'cancel', timerId: '550e8400-e29b-41d4-a716-446655440000' });
});

test('avvisar godtyckliga pushservrar och orimligt långa larm', () => {
  assert.throws(() => normalizeAlarmRequest({
    action: 'schedule',
    timerId: '550e8400-e29b-41d4-a716-446655440000',
    endAt: now + 90_000,
    exercise: 'Bänkpress',
    subscription: { ...subscription, endpoint: 'https://attacker.example/push' }
  }, now), /inte tillåten/);
  assert.throws(() => normalizeAlarmRequest({
    action: 'reschedule',
    timerId: '550e8400-e29b-41d4-a716-446655440000',
    endAt: now + 30 * 60_000,
    exercise: 'Bänkpress'
  }, now), /utanför tillåtet intervall/);
});

test('begränsar API-anrop till appens och tjänstens ursprung', () => {
  assert.equal(isAllowedOrigin('https://jnyskg-ai.github.io'), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:4173'), true);
  assert.equal(isAllowedOrigin('https://rsg-coach-alarm-demo.vercel.app'), true);
  assert.equal(isAllowedOrigin('https://attacker.example'), false);
});

