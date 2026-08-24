(function initRestAlarm(global) {
  'use strict';

  const SETTINGS_KEY = 'rsg_rest_alarm_settings_v1';
  const META_NAME = 'rsg-alarm-api';
  let registration = null;
  let audioContext = null;
  let statusListener = null;

  function apiBase() {
    const configured = global.RSG_ALARM_API_BASE
      || global.document?.querySelector?.(`meta[name="${META_NAME}"]`)?.content
      || '';
    return String(configured).replace(/\/$/, '');
  }

  function readSettings() {
    try {
      return JSON.parse(global.localStorage?.getItem(SETTINGS_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function saveSettings(patch) {
    try {
      global.localStorage?.setItem(SETTINGS_KEY, JSON.stringify({ ...readSettings(), ...patch }));
    } catch (_) {}
  }

  function isSupported() {
    return Boolean(
      global.isSecureContext
      && 'serviceWorker' in global.navigator
      && 'PushManager' in global
      && 'Notification' in global
    );
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(global.navigator?.userAgent || '')
      || (global.navigator?.platform === 'MacIntel' && global.navigator?.maxTouchPoints > 1);
  }

  function isStandalone() {
    return global.matchMedia?.('(display-mode: standalone)').matches
      || global.navigator?.standalone === true;
  }

  function emitStatus(status) {
    if (typeof statusListener === 'function') statusListener(status);
    return status;
  }

  async function getStatus() {
    if (!isSupported()) {
      return emitStatus({ code: 'unsupported', label: 'Stöds inte', enabled: false });
    }
    if (isIOS() && !isStandalone()) {
      return emitStatus({ code: 'install', label: 'Installera på hemskärmen', enabled: false });
    }
    if (global.Notification.permission === 'denied') {
      return emitStatus({ code: 'blocked', label: 'Blockerat i inställningar', enabled: false });
    }
    if (global.Notification.permission !== 'granted') {
      return emitStatus({ code: 'permission', label: 'Inte aktiverat', enabled: false });
    }
    try {
      const activeRegistration = registration || await global.navigator.serviceWorker.ready;
      const subscription = await activeRegistration.pushManager.getSubscription();
      return emitStatus(subscription
        ? { code: 'enabled', label: 'Aktiverat', enabled: true }
        : { code: 'subscribe', label: 'Behöver aktiveras', enabled: false });
    } catch (_) {
      return emitStatus({ code: 'error', label: 'Kunde inte kontrolleras', enabled: false });
    }
  }

  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = global.atob(base64);
    return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
  }

  async function fetchConfig() {
    const base = apiBase();
    if (!base) throw new Error('Bakgrundslarmet är inte anslutet ännu.');
    const response = await global.fetch(`${base}/api/config`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Larmtjänsten svarar inte just nu.');
    const config = await response.json();
    if (!config.vapidPublicKey) throw new Error('Larmtjänsten saknar notifieringsnyckel.');
    return config;
  }

  async function ensureSubscription(create = false) {
    const activeRegistration = registration || await global.navigator.serviceWorker.ready;
    let subscription = await activeRegistration.pushManager.getSubscription();
    if (!subscription && create) {
      const { vapidPublicKey } = await fetchConfig();
      subscription = await activeRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });
    }
    return subscription;
  }

  async function enable() {
    if (!isSupported()) throw new Error('Den här webbläsaren stöder inte bakgrundslarm.');
    if (isIOS() && !isStandalone()) {
      throw new Error('Lägg först RSG Coach på hemskärmen och öppna appen därifrån.');
    }
    const permission = global.Notification.permission === 'granted'
      ? 'granted'
      : await global.Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error(permission === 'denied'
        ? 'Notiser är blockerade. Tillåt dem för RSG Coach i iPhone-inställningarna.'
        : 'Tillåt notiser för att få ljud när appen är stängd.');
    }
    const subscription = await ensureSubscription(true);
    saveSettings({ enabled: true, enabledAt: Date.now() });
    await getStatus();
    return subscription;
  }

  function createTimerId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    global.crypto?.getRandomValues?.(bytes);
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function postAlarm(payload, retries = 0) {
    const base = apiBase();
    if (!base) return { scheduled: false, reason: 'unconfigured' };
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await global.fetch(`${base}/api/rest-alarm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        });
        if (response.ok) return await response.json();
        if (response.status !== 404 && response.status < 500) break;
        lastError = new Error(`Larmtjänsten svarade ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
    throw lastError || new Error('Larmtjänsten kunde inte nås.');
  }

  async function schedule({ timerId, endAt, exercise }) {
    if (!timerId || !(endAt > Date.now())) return { scheduled: false, reason: 'invalid' };
    if (!isSupported() || global.Notification.permission !== 'granted') {
      return { scheduled: false, reason: 'permission' };
    }
    const subscription = await ensureSubscription(false);
    if (!subscription) return { scheduled: false, reason: 'subscription' };
    return postAlarm({
      action: 'schedule',
      timerId,
      endAt,
      exercise,
      subscription: subscription.toJSON()
    }, 1);
  }

  async function reschedule({ timerId, endAt, exercise }) {
    if (!timerId || !(endAt > Date.now())) return { scheduled: false, reason: 'invalid' };
    if (!isSupported() || global.Notification.permission !== 'granted') {
      return { scheduled: false, reason: 'permission' };
    }
    return postAlarm({ action: 'reschedule', timerId, endAt, exercise }, 4);
  }

  async function cancel(timerId) {
    if (!timerId || !isSupported() || global.Notification.permission !== 'granted') {
      return { cancelled: false };
    }
    try {
      return await postAlarm({ action: 'cancel', timerId }, 1);
    } catch (_) {
      return { cancelled: false };
    }
  }

  function getAudioContext() {
    const AudioContext = global.AudioContext || global.webkitAudioContext;
    if (!AudioContext) return null;
    if (!audioContext) audioContext = new AudioContext();
    return audioContext;
  }

  async function primeAudio() {
    const context = getAudioContext();
    if (!context) return false;
    if (context.state === 'suspended') await context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + 0.02);
    return true;
  }

  async function playChime() {
    const context = getAudioContext();
    if (!context) return false;
    if (context.state === 'suspended') await context.resume();
    const start = context.currentTime + 0.02;
    [880, 1174.66, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const toneStart = start + index * 0.23;
      oscillator.type = index === 1 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, toneStart);
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(0.3, toneStart + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneStart + 0.2);
    });
    global.navigator?.vibrate?.([220, 90, 220]);
    return true;
  }

  async function test() {
    await playChime();
    if (!isSupported() || global.Notification.permission !== 'granted') return { notification: false };
    const activeRegistration = registration || await global.navigator.serviceWorker.ready;
    await activeRegistration.showNotification('RSG Coach – vilolarm', {
      body: 'Ljud och systemnotiser är aktiverade.',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'rsg-rest-alarm-test',
      renotify: true,
      silent: false,
      data: { url: './Coash%201.0.html' }
    });
    return { notification: true };
  }

  async function init(activeRegistration) {
    registration = activeRegistration || registration;
    return getStatus();
  }

  global.RSG_REST_ALARM = {
    SETTINGS_KEY,
    apiBase,
    cancel,
    createTimerId,
    enable,
    getStatus,
    init,
    isStandalone,
    isSupported,
    onStatusChange(listener) { statusListener = listener; },
    playChime,
    primeAudio,
    reschedule,
    schedule,
    test,
    urlBase64ToUint8Array
  };
})(globalThis);
