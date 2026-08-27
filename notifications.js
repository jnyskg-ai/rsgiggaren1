/* RSG Coach — system notifications for the rest timer.
 *
 * This module keeps the existing timer and training-data model intact. It adds
 * a notification permission UI, uses the active service worker to show a
 * system notification when rest ends, and leaves the service worker ready to
 * receive real Web Push payloads from a sender backend.
 */
(() => {
  'use strict';

  const PROMPTED_KEY = 'rsg_rest_notification_prompted_v1';
  const IOS_RE = /iphone|ipad|ipod/i;

  const supportsNotifications = () => 'Notification' in globalThis && 'serviceWorker' in navigator;
  const isIOS = () => IOS_RE.test(navigator.userAgent || '');
  const isStandalone = () => (typeof globalThis.matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

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
    // startTimer is called directly from the user's set-log button, which gives
    // iOS the required user activation for the permission prompt.
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
      <h2>🔔 Vilotimer-notiser</h2>
      <p>Få en systemnotis med iPhones normala notisljud när vilan är slut. På iPhone måste RSG Coach vara installerad på hemskärmen.</p>
      <div class="why"><b>Status</b><br><span id="restNotificationStatus"></span></div>
      <button id="enableRestNotifications" class="btn primary" type="button" style="margin-top:10px">Aktivera vilonotiser</button>
      <small style="display:block;margin-top:9px">Om appen tvångsstängs helt krävs Web Push från en server. Appens service worker är förberedd för det, men en push-server måste vara kopplad för garanterad leverans i det läget.</small>`;
    profile.append(card);
    document.querySelector('#enableRestNotifications')?.addEventListener('click', () => requestPermission());
    updateStatus();
  }

  if (typeof startTimer === 'function') {
    const nativeStartTimer = startTimer;
    startTimer = function startTimerWithNotifications(sec, exercise) {
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
      if (notify) void showRestNotification(exercise);
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
    permissionLabel
  });
})();
