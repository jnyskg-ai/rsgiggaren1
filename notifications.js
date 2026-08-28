/* RSG Coach — audible rest timer + real Web Push scheduling for iPhone PWA. */
(() => {
  'use strict';

  const PROMPTED_KEY = 'rsg_rest_notification_prompted_v1';
  const IOS_RE = /iphone|ipad|ipod/i;
  const PUSH_API_BASE = 'https://rsg-coach-push-rsgiggaren.vercel.app';
  const VAPID_PUBLIC_KEY = 'BAqw-9r_ZUjKmJ8NVkrSefAZV9LhYA_MTSOv98pmeWCnoRCqUOnzrTVFGng0wnnatLU-tuiNJ9_-vbuQkfaa7QA';
  let audioContext = null;
  let currentScheduleId = '';

  const supportsNotifications = () => 'Notification' in globalThis && 'serviceWorker' in navigator;
  const supportsPush = () => supportsNotifications() && 'PushManager' in globalThis;
  const isIOS = () => IOS_RE.test(navigator.userAgent || '');
  const isStandalone = () => (typeof globalThis.matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  function ensureAudioContext() {
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
    return audioContext;
  }

  function unlockAudio() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.01);
    } catch (_) {}
  }

  function playRestTone() {
    const ctx = ensureAudioContext();
    if (!ctx) return false;
    try {
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.55, now + 0.015);
      master.gain.setValueAtTime(0.55, now + 0.95);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
      master.connect(ctx.destination);
      [880, 1046.5, 1318.5].forEach((freq, index) => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, now + index * 0.32);
        osc.connect(master);
        osc.start(now + index * 0.32);
        osc.stop(now + index * 0.32 + 0.22);
      });
      if (navigator.vibrate) navigator.vibrate([220, 90, 220, 90, 300]);
      return true;
    } catch (error) {
      console.warn('Kunde inte spela vilotimer-ljud', error);
      return false;
    }
  }

  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
  }

  async function registration() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await navigator.serviceWorker.ready; }
    catch (_) { return null; }
  }

  function permissionLabel() {
    if (!supportsNotifications()) return 'Stöds inte i den här webbläsaren';
    if (isIOS() && !isStandalone()) return 'Installera RSG Coach på hemskärmen först';
    if (globalThis.Notification.permission === 'granted') return supportsPush() ? 'På – Web Push och ljud är aktiverade' : 'På – notiser är tillåtna';
    if (globalThis.Notification.permission === 'denied') return 'Av – tillåt notiser i iPhone-inställningarna';
    return 'Inte aktiverat';
  }

  function updateStatus(extra = '') {
    const status = document.querySelector('#restNotificationStatus');
    const button = document.querySelector('#enableRestNotifications');
    if (status) status.textContent = extra || permissionLabel();
    if (button) {
      const granted = supportsNotifications() && globalThis.Notification.permission === 'granted';
      button.textContent = granted ? 'Notiser aktiverade' : 'Aktivera vilonotiser';
      button.disabled = granted;
    }
  }

  async function requestPermission({ automatic = false } = {}) {
    unlockAudio();
    if (!supportsNotifications()) {
      if (!automatic && typeof toast === 'function') toast('Systemnotiser stöds inte här');
      return false;
    }
    if (isIOS() && !isStandalone()) {
      if (!automatic && typeof toast === 'function') toast('Lägg RSG Coach på hemskärmen först');
      updateStatus();
      return false;
    }
    if (globalThis.Notification.permission === 'granted') {
      updateStatus();
      return true;
    }
    if (globalThis.Notification.permission === 'denied') {
      if (!automatic && typeof toast === 'function') toast('Tillåt RSG Coach-notiser i iPhone-inställningarna');
      updateStatus();
      return false;
    }
    try {
      localStorage.setItem(PROMPTED_KEY, '1');
      const result = await globalThis.Notification.requestPermission();
      updateStatus();
      if (!automatic && typeof toast === 'function') toast(result === 'granted' ? 'Vilotimer-notiser är aktiverade' : 'Notiser aktiverades inte');
      return result === 'granted';
    } catch (error) {
      console.warn('Kunde inte begära notisbehörighet', error);
      updateStatus();
      return false;
    }
  }

  async function maybePromptFromTimerGesture() {
    if (!supportsNotifications() || globalThis.Notification.permission !== 'default') return;
    if (localStorage.getItem(PROMPTED_KEY)) return;
    if (isIOS() && !isStandalone()) return;
    await requestPermission({ automatic: true });
  }

  async function ensurePushSubscription() {
    if (!supportsPush()) return null;
    if (globalThis.Notification.permission !== 'granted') return null;
    const reg = await registration();
    if (!reg?.pushManager) return null;
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    return subscription;
  }

  async function setActiveScheduleInWorker(scheduleId, endAt, exercise) {
    const reg = await registration();
    const worker = reg?.active || navigator.serviceWorker.controller;
    if (!worker) return;
    worker.postMessage({ type: 'SET_ACTIVE_REST_SCHEDULE', scheduleId, endAt, exercise: exercise || 'Nästa set' });
  }

  async function clearActiveScheduleInWorker() {
    const reg = await registration();
    const worker = reg?.active || navigator.serviceWorker.controller;
    currentScheduleId = '';
    if (worker) worker.postMessage({ type: 'CLEAR_ACTIVE_REST_SCHEDULE' });
  }

  async function scheduleRemoteRest(endAt, exercise) {
    if (!endAt) return false;
    const scheduleId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    currentScheduleId = scheduleId;
    await setActiveScheduleInWorker(scheduleId, endAt, exercise);

    try {
      const subscription = await ensurePushSubscription();
      if (!subscription) return false;
      const response = await fetch(`${PUSH_API_BASE}/api/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          endAt,
          scheduleId,
          exercise: exercise || 'Nästa set'
        })
      });
      if (!response.ok) throw new Error(`Push-server svarade ${response.status}`);
      updateStatus('På – Web Push är ansluten');
      return true;
    } catch (error) {
      console.warn('Kunde inte schemalägga Web Push', error);
      updateStatus('Notiser tillåtna – push-server kunde inte nås');
      return false;
    }
  }

  async function showRestNotification(exercise) {
    if (!supportsNotifications() || globalThis.Notification.permission !== 'granted') return false;
    const reg = await registration();
    if (!reg) return false;
    try {
      await reg.showNotification('Vilan är klar', {
        body: exercise ? `${exercise} – kör nästa set.` : 'Kör nästa set.',
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'rsg-rest-timer',
        renotify: true,
        silent: false,
        data: { url: './Coash%201.0.html#train', kind: 'rest-timer' }
      });
      return true;
    } catch (error) {
      console.warn('Kunde inte visa vilonotis', error);
      return false;
    }
  }

  function installUI() {
    if (document.querySelector('#restNotificationCard')) return;
    const profile = document.querySelector('#profile');
    if (!profile) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'restNotificationCard';
    card.innerHTML = `
      <h2>🔔 Vilotimer-ljud</h2>
      <p>När appen är öppen spelas ett tydligt tretons-larm. När RSG Coach ligger i bakgrunden skickas vilan till en Web Push-server som väcker iPhones systemnotis.</p>
      <button id="testRestSound" class="btn primary" type="button">🔊 Testa larmet nu</button>
      <div class="why" style="margin-top:10px"><b>Bakgrundsnotis</b><br><span id="restNotificationStatus"></span></div>
      <button id="enableRestNotifications" class="btn secondary" type="button" style="margin-top:10px">Aktivera vilonotiser</button>`;
    profile.append(card);
    document.querySelector('#testRestSound')?.addEventListener('click', () => {
      unlockAudio();
      if (playRestTone() && typeof toast === 'function') toast('Detta är vilotimer-larmet');
    });
    document.querySelector('#enableRestNotifications')?.addEventListener('click', async () => {
      const granted = await requestPermission();
      if (granted) {
        try {
          await ensurePushSubscription();
          updateStatus('På – Web Push och ljud är aktiverade');
        } catch (error) {
          console.warn('Kunde inte skapa push-prenumeration', error);
          updateStatus('Notiser tillåtna – Web Push kunde inte aktiveras');
        }
      }
    });
    updateStatus();
  }

  ['pointerdown', 'touchend', 'click'].forEach(type => {
    document.addEventListener(type, unlockAudio, { passive: true, capture: true });
  });

  if (typeof startTimer === 'function') {
    const nativeStartTimer = startTimer;
    startTimer = function startTimerWithNotifications(sec, exercise) {
      unlockAudio();
      const result = nativeStartTimer(sec, exercise);
      const endAt = typeof timerEndAt === 'number' ? timerEndAt : Date.now() + Number(sec || 0) * 1000;
      void maybePromptFromTimerGesture().then(() => scheduleRemoteRest(endAt, exercise));
      return result;
    };
  }

  if (typeof finishTimer === 'function') {
    const nativeFinishTimer = finishTimer;
    finishTimer = function finishTimerWithNotifications(notify = true) {
      const exercise = typeof timerExercise === 'string' ? timerExercise : '';
      const wasHidden = document.hidden;
      const result = nativeFinishTimer(notify);
      void clearActiveScheduleInWorker();
      if (notify) {
        if (wasHidden) void showRestNotification(exercise);
        else playRestTone();
      }
      return result;
    };
  }

  document.addEventListener('click', event => {
    const id = event.target?.id;
    if (id === 'addTimer') {
      setTimeout(() => {
        if (typeof timerEndAt === 'number' && timerEndAt > Date.now()) void scheduleRemoteRest(timerEndAt, typeof timerExercise === 'string' ? timerExercise : 'Nästa set');
      }, 0);
    }
    if (id === 'stopTimer') void clearActiveScheduleInWorker();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateStatus();
  });

  installUI();
  setTimeout(installUI, 0);

  globalThis.RSG_NOTIFICATIONS = Object.freeze({
    requestPermission,
    showRestNotification,
    playRestTone,
    ensurePushSubscription,
    scheduleRemoteRest,
    permissionLabel
  });
})();
