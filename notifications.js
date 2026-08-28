/* RSG Coach — robust rest-timer audio + background notification scheduling. */
(() => {
  'use strict';

  const PROMPTED_KEY = 'rsg_rest_notification_prompted_v1';
  const IOS_RE = /iphone|ipad|ipod/i;
  let audioContext = null;
  let currentScheduleId = '';

  const supportsNotifications = () => 'Notification' in globalThis && 'serviceWorker' in navigator;
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

  async function registration() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await navigator.serviceWorker.ready; }
    catch (_) { return null; }
  }

  function permissionLabel() {
    if (!supportsNotifications()) return 'Stöds inte i den här webbläsaren';
    if (isIOS() && !isStandalone()) return 'Installera RSG Coach på hemskärmen först';
    if (globalThis.Notification.permission === 'granted') return 'På – ljud och bakgrundsnotiser är aktiverade';
    if (globalThis.Notification.permission === 'denied') return 'Av – tillåt notiser i iPhone-inställningarna';
    return 'Inte aktiverat';
  }

  function updateStatus() {
    const status = document.querySelector('#restNotificationStatus');
    const button = document.querySelector('#enableRestNotifications');
    if (status) status.textContent = permissionLabel();
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

  async function scheduleInServiceWorker(endAt, exercise) {
    const reg = await registration();
    const worker = reg?.active || navigator.serviceWorker.controller;
    if (!worker || !endAt) return false;
    currentScheduleId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    worker.postMessage({
      type: 'SCHEDULE_REST_NOTIFICATION',
      scheduleId: currentScheduleId,
      endAt,
      exercise: exercise || 'Nästa set'
    });
    return true;
  }

  async function cancelServiceWorkerSchedule() {
    const reg = await registration();
    const worker = reg?.active || navigator.serviceWorker.controller;
    currentScheduleId = '';
    if (worker) worker.postMessage({ type: 'CANCEL_REST_NOTIFICATION' });
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
      <p>RSG Coach låser upp ljudet när du loggar ett set. När appen är öppen spelas ett tydligt tretons-larm. I bakgrunden försöker service workern leverera en systemnotis med ljud.</p>
      <button id="testRestSound" class="btn primary" type="button">🔊 Testa larmet nu</button>
      <div class="why" style="margin-top:10px"><b>Bakgrundsnotis</b><br><span id="restNotificationStatus"></span></div>
      <button id="enableRestNotifications" class="btn secondary" type="button" style="margin-top:10px">Aktivera vilonotiser</button>`;
    profile.append(card);
    document.querySelector('#testRestSound')?.addEventListener('click', () => {
      unlockAudio();
      if (playRestTone() && typeof toast === 'function') toast('Detta är vilotimer-larmet');
    });
    document.querySelector('#enableRestNotifications')?.addEventListener('click', () => requestPermission());
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
      void scheduleInServiceWorker(endAt, exercise);
      void maybePromptFromTimerGesture();
      return result;
    };
  }

  if (typeof finishTimer === 'function') {
    const nativeFinishTimer = finishTimer;
    finishTimer = function finishTimerWithNotifications(notify = true) {
      const exercise = typeof timerExercise === 'string' ? timerExercise : '';
      const wasHidden = document.hidden;
      const result = nativeFinishTimer(notify);
      void cancelServiceWorkerSchedule();
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
        if (typeof timerEndAt === 'number' && timerEndAt > Date.now()) void scheduleInServiceWorker(timerEndAt, typeof timerExercise === 'string' ? timerExercise : 'Nästa set');
      }, 0);
    }
    if (id === 'stopTimer') void cancelServiceWorkerSchedule();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      updateStatus();
      try {
        const saved = JSON.parse(localStorage.getItem('rsg_timer') || localStorage.getItem('rsg_timer_v1') || 'null');
        if (saved?.endAt && saved.endAt <= Date.now()) {
          playRestTone();
          void showRestNotification(saved.exercise || '');
        }
      } catch (_) {}
    }
  });

  installUI();
  setTimeout(installUI, 0);

  globalThis.RSG_NOTIFICATIONS = Object.freeze({
    requestPermission,
    showRestNotification,
    playRestTone,
    scheduleInServiceWorker,
    permissionLabel
  });
})();
