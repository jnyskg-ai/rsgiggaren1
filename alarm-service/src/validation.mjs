const TIMER_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
const PUSH_KEY_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;
const MAX_DELAY_MS = 20 * 60 * 1000;

const ALLOWED_PUSH_HOSTS = new Set([
  'web.push.apple.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com'
]);

const ALLOWED_ORIGINS = new Set([
  'https://jnyskg-ai.github.io',
  'http://127.0.0.1:4173',
  'http://localhost:4173'
]);

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return /^https:\/\/rsg-coach-alarm(?:-[a-z0-9-]+)?\.vercel\.app$/.test(origin);
}

export function hookToken(timerId) {
  return `rsg-rest:${timerId}`;
}

function normalizeTimerId(value) {
  const timerId = String(value || '');
  if (!TIMER_ID_PATTERN.test(timerId)) throw new Error('Ogiltigt timer-id.');
  return timerId;
}

function normalizeExercise(value) {
  return String(value || 'Nästa set')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Nästa set';
}

function normalizeEndAt(value, now) {
  const endAt = Number(value);
  if (!Number.isInteger(endAt) || endAt < now + 500 || endAt > now + MAX_DELAY_MS) {
    throw new Error('Vilotidens sluttid ligger utanför tillåtet intervall.');
  }
  return endAt;
}

function normalizeSubscription(value) {
  if (!value || typeof value !== 'object') throw new Error('Push-prenumeration saknas.');
  let endpoint;
  try {
    endpoint = new URL(String(value.endpoint || ''));
  } catch (_) {
    throw new Error('Ogiltig push-adress.');
  }
  if (endpoint.protocol !== 'https:' || !ALLOWED_PUSH_HOSTS.has(endpoint.hostname) || endpoint.href.length > 2048) {
    throw new Error('Push-adressen är inte tillåten.');
  }
  const p256dh = String(value.keys?.p256dh || '');
  const auth = String(value.keys?.auth || '');
  if (!PUSH_KEY_PATTERN.test(p256dh) || !PUSH_KEY_PATTERN.test(auth)) {
    throw new Error('Push-prenumerationens nycklar är ogiltiga.');
  }
  return { endpoint: endpoint.href, expirationTime: null, keys: { p256dh, auth } };
}

export function normalizeAlarmRequest(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Ogiltig begäran.');
  const action = String(body.action || '');
  const timerId = normalizeTimerId(body.timerId);

  if (action === 'cancel') return { action, timerId };
  if (action === 'reschedule') {
    return {
      action,
      timerId,
      endAt: normalizeEndAt(body.endAt, now),
      exercise: normalizeExercise(body.exercise)
    };
  }
  if (action === 'schedule') {
    return {
      action,
      timerId,
      endAt: normalizeEndAt(body.endAt, now),
      exercise: normalizeExercise(body.exercise),
      subscription: normalizeSubscription(body.subscription)
    };
  }
  throw new Error('Okänd larmåtgärd.');
}

