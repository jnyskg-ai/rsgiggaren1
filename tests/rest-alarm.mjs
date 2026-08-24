import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'rest-alarm.js'), 'utf8');
const storage = new Map();
const requests = [];
const shownNotifications = [];
let activeSubscription = null;

const subscription = {
  toJSON() {
    return {
      endpoint: 'https://web.push.apple.com/QPUSH_TOKEN',
      keys: { p256dh: 'public-key-value', auth: 'auth-key-value' }
    };
  }
};

const registration = {
  pushManager: {
    async getSubscription() { return activeSubscription; },
    async subscribe(options) {
      assert.equal(options.userVisibleOnly, true);
      assert(options.applicationServerKey instanceof Uint8Array);
      activeSubscription = subscription;
      return subscription;
    }
  },
  async showNotification(title, options) { shownNotifications.push({ title, options }); }
};

class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 1; this.destination = {}; }
  async resume() { this.state = 'running'; }
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime() {} },
      connect(node) { return node; },
      start() {},
      stop() {}
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {}
      },
      connect(node) { return node; }
    };
  }
}

const Notification = {
  permission: 'default',
  async requestPermission() { this.permission = 'granted'; return 'granted'; }
};

const context = vm.createContext({
  console,
  isSecureContext: true,
  document: { querySelector: () => ({ content: 'https://rsg-coach-alarm.vercel.app' }) },
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value))
  },
  navigator: {
    userAgent: 'Mozilla/5.0 (iPhone)',
    standalone: true,
    serviceWorker: { ready: Promise.resolve(registration) },
    vibrate() {}
  },
  matchMedia: () => ({ matches: true }),
  PushManager: class {},
  Notification,
  AudioContext: FakeAudioContext,
  crypto: { randomUUID: () => '550e8400-e29b-41d4-a716-446655440000' },
  atob,
  Uint8Array,
  Date,
  Math,
  Promise,
  setTimeout,
  fetch: async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/api/config')) {
      return { ok: true, status: 200, async json() { return { vapidPublicKey: 'AQIDBA' }; } };
    }
    return {
      ok: true,
      status: 202,
      async json() {
        const action = JSON.parse(options.body).action;
        return action === 'cancel' ? { cancelled: true } : { scheduled: true };
      }
    };
  }
});

vm.runInContext(source, context, { filename: 'rest-alarm.js' });
const alarm = context.RSG_REST_ALARM;
assert(alarm, 'Larmmodulen skapades inte');

await alarm.init(registration);
await alarm.enable();
assert.equal((await alarm.getStatus()).enabled, true, 'Bakgrundslarmet aktiverades inte');
assert.equal(alarm.createTimerId(), '550e8400-e29b-41d4-a716-446655440000');

const timer = { timerId: alarm.createTimerId(), endAt: Date.now() + 60_000, exercise: 'Bänkpress' };
await alarm.schedule(timer);
await alarm.reschedule({ ...timer, endAt: timer.endAt + 30_000 });
await alarm.cancel(timer.timerId);
await alarm.test();

const alarmBodies = requests.filter(request => request.url.endsWith('/api/rest-alarm')).map(request => JSON.parse(request.options.body));
assert.deepEqual(alarmBodies.map(body => body.action), ['schedule', 'reschedule', 'cancel']);
assert.equal(alarmBodies[0].subscription.endpoint, 'https://web.push.apple.com/QPUSH_TOKEN');
assert.equal(shownNotifications.length, 1, 'Testnotisen visades inte');
assert.equal(shownNotifications[0].options.silent, false, 'Testnotisen får inte vara tyst');
assert(storage.has(alarm.SETTINGS_KEY), 'Aktiveringen sparades inte');

console.log('OK: ljudupplåsning, pushaktivering, schemaläggning, förlängning, stopp och testnotis.');

