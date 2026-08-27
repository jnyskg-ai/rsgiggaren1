/* RSG Coach — system notifications and audible rest-timer signal. */
(() => {
  'use strict';

  const PROMPTED_KEY = 'rsg_rest_notification_prompted_v1';
  const IOS_RE = /iphone|ipad|ipod/i;
  let audioContext = null;

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

  function playRestTone() {
    const ctx = ensureAudioContext();
    if (!ctx) return false;
    try {
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.32, now + 0.015);
      master.gain.setValueAtTime(0.32, now + 0.48);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.68);
      master.connect(ctx.destination);

      const first = ctx.createOscillator();
      first.type = 'sine';
      first.frequency.setValueAtTime(880, now);
      first.connect(master);
      first.start(now);
      first.stop(now + 0.22);

      const second = ctx.createOscillator();
      second.type = 'sine';
      second.frequency.setValueAtTime(1046.5, now + 0.28);
      second.connect(master);
      second.start(now + 0.28);
      second.stop(now + 0.58);
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
    if (globalThis.Notification.permission === 'granted') return 'På – systemnotiser är tillåtna';
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
      if (!automatic && typeof toast === 'function') {
        toast(result === 'granted' ? 'Vilotimer-notiser är aktiverade' : 'Notiser aktiverades inte');
      }
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

  function installUI() {
    if (document.querySelector('#restNotificationCard')) return;
    const profile = document.querySelector('#profile');
    if (!profile) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'restNotificationCard';
    card.innerHTML = `
      <h2>🔔 Vilotimer-ljud</h2>
      <p>När RSG Coach är öppen spelas en tydlig dubbelton. När appen ligger i bakgrunden används iPhones systemnotis med ljud.</p>
      <button id="testRestSound" class="btn primary" type="button">🔊 Testa ljud nu</button>
      <div class="why" style="margin-top:10px"><b>Bakgrundsnotis</b><br><span id="restNotificationStatus"></span></div>
      <button id="enableRestNotifications" class="btn secondary" type="button" style="margin-top:10px">Aktivera vilonotiser</button>`;
    profile.append(card);
    document.querySelector('#testRestSound')?.addEventListener('click', () => {
      if (playRestTone() && typeof toast === 'function') toast('Detta är vilotimer-ljudet');
    });
    document.querySelector('#enableRestNotifications')?.addEventListener('click', () => requestPermission());
    updateStatus();
  }

  if (typeof startTimer === 'function') {
    const nativeStartTimer = startTimer;
    startTimer = function startTimerWithNotifications(sec, exercise) {
      ensureAudioContext();
      const result = nativeStartTimer(sec, exercise);
      void maybePromptFromTimerGesture();
      return result;
    };
  }

  if (typeof finishTimer === 'function') {
    const nativeFinishTimer = finishTimer;
    finishTimer = function finishTimerWithNotifications(notify = true) {
      const exercise = typeof timerExercise === 'string' ? timerExercise : '';
      const result = nativeFinishTimer(notify);
      if (notify) {
        if (document.hidden) void showRestNotification(exercise);
        else playRestTone();
      }
      return result;
    };
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateStatus();
  });

  installUI();
  setTimeout(installUI, 0);

  globalThis.RSG_NOTIFICATIONS = Object.freeze({
    requestPermission,
    showRestNotification,
    playRestTone,
    permissionLabel
  });
})();
