import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const url = 'http://127.0.0.1:4173/';
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  if (String(error).includes("Executable doesn't exist")) {
    console.log('SKIP: Playwrights Chromium-binär finns inte i den här miljön.');
    process.exit(0);
  }
  throw error;
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', error => browserErrors.push(error.message));

  await page.goto(url, { waitUntil: 'networkidle' });
  assert.equal(new URL(page.url()).pathname, '/Coash%201.0.html', 'Rotadressen skickade inte vidare till den befintliga appen');
  assert((await page.locator('body').innerText()).trim().length > 200, 'Sidan är tom');
  assert.equal(await page.locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay').count(), 0, 'Fel-overlay visas');
  assert(await page.locator('#onboarding.on').isVisible(), 'Onboarding ska visas för en ny användare');

  await page.locator('#obName').fill('RSG Test');
  await page.locator('#onboardNext').click();
  await page.locator('[data-obgoal="muscle"]').click();
  await page.locator('#onboardNext').click();
  await page.locator('[data-obexp="advanced"]').click();
  await page.locator('#onboardNext').click();
  await page.locator('[data-obdays="6"]').click();
  await page.locator('#onboardNext').click();
  assert.equal(await page.locator('#onboarding.on').count(), 0, 'Onboarding stängdes inte');

  await page.locator('.nav [data-go="train"]').click();
  assert.equal(await page.locator('#train.on').count(), 1, 'Träningsvyn öppnades inte');
  assert.equal(await page.locator('#exerciseList .exercise').count(), 12, 'Push A ska ha tolv övningar');

  const secondSet = page.locator('#exerciseList .exercise').first().locator('.set').nth(1);
  await secondSet.locator('button').click();
  assert((await page.locator('#toast').innerText()).includes('vikt och reps'), 'Ofullständigt set ska stoppas');
  assert.equal(await secondSet.locator('button.done').count(), 0, 'Ofullständigt set markerades som loggat');

  let firstExercise = page.locator('#exerciseList .exercise').first();
  await firstExercise.locator('.set').first().locator('.kg').fill('100');
  await firstExercise.locator('.set').first().locator('.reps').fill('8');
  await firstExercise.locator('.set').first().locator('button').click();
  assert(await page.locator('#timer.on').isVisible(), 'Vilotimern startade inte');
  const initialEnd = await page.evaluate(() => JSON.parse(localStorage.getItem('rsg_ai_rest_timer_v2')).endAt);
  await page.locator('#addTimer').click();
  const extendedEnd = await page.evaluate(() => JSON.parse(localStorage.getItem('rsg_ai_rest_timer_v2')).endAt);
  assert.equal(extendedEnd - initialEnd, 30000, '+30 sekunder ändrade inte sluttiden korrekt');

  await firstExercise.locator('.swap-btn').click();
  await firstExercise.locator('.swap-select').selectOption('Hantelpress plan bänk');
  await firstExercise.locator('.apply-swap').click();
  firstExercise = page.locator('#exerciseList .exercise').first();
  assert.equal((await firstExercise.locator('h3').innerText()).trim(), 'Hantelpress plan bänk', 'Övningsbytet genomfördes inte');
  await firstExercise.locator('.set').first().locator('.kg').fill('42.5');
  await firstExercise.locator('.set').first().locator('.reps').fill('12');
  await firstExercise.locator('.set').first().locator('button').click();

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.nav [data-go="train"]').click();
  firstExercise = page.locator('#exerciseList .exercise').first();
  assert.equal((await firstExercise.locator('h3').innerText()).trim(), 'Hantelpress plan bänk', 'Övningsbytet överlevde inte omladdning');
  assert.equal(await firstExercise.locator('.set').first().locator('.kg').inputValue(), '42.5', 'Passutkastets vikt återställdes inte');
  assert.equal(await firstExercise.locator('.set').first().locator('.reps').inputValue(), '12', 'Passutkastets reps återställdes inte');
  assert.equal(await firstExercise.locator('.set').first().locator('button.done').count(), 1, 'Loggat set återställdes inte');

  const pwa = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return { controlled: Boolean(navigator.serviceWorker.controller), active: Boolean(registration.active), caches: await caches.keys() };
  });
  assert(pwa.controlled && pwa.active, 'Service worker styr inte sidan efter omladdning');
  assert(pwa.caches.includes('rsg-coach-shell-4.7.1'), 'Versionerad app-cache saknas');

  await page.screenshot({ path: '/tmp/rsg-coach-mobile.png', fullPage: false });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert((await page.locator('body').innerText()).includes('RSG AI COACH'), 'Appen laddades inte offline');
  await context.setOffline(false);

  assert.deepEqual(browserErrors, [], `Webbläsarfel: ${browserErrors.join(' | ')}`);
  await context.close();

  const migrationContext = await browser.newContext();
  const migrationPage = await migrationContext.newPage();
  await migrationPage.goto(url, { waitUntil: 'domcontentloaded' });
  await migrationPage.evaluate(() => localStorage.setItem('rsg_ai_complete_v1', JSON.stringify({
    profile: { name: 'Befintlig användare' },
    program: 'Upper/Lower',
    sessions: [{ date: '2026-08-19', marker: 'bevarad', exercises: [], volume: 0 }],
    onboarded: true
  })));
  await migrationPage.reload({ waitUntil: 'domcontentloaded' });
  const migrated = await migrationPage.evaluate(() => JSON.parse(localStorage.getItem('rsg_ai_complete_v1')));
  assert.equal(migrated.schemaVersion, 3, 'Dataschemat migrerades inte');
  assert.equal(migrated.sessions[0].marker, 'bevarad', 'Befintlig träningshistorik förlorades vid migrering');
  assert.equal(migrated.profile.name, 'Befintlig användare', 'Befintlig profil förlorades vid migrering');
  await migrationContext.close();

  console.log('OK: mobilflöde, timer, övningsbyte, passutkast, migrering, PWA och offline-läge.');
} finally {
  await browser.close();
}
