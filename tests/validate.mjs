import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(root, 'Coash 1.0.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

assert(script, 'Appens scriptblock saknas');
new Function(script);

const dataSource = html.slice(html.indexOf('const W='), html.indexOf('const CARDIO='));
const { PROGRAMS, EX } = new Function(`${dataSource};return {PROGRAMS,EX}`)();
const libraryNames = new Set(EX.map(exercise => exercise[0]));
const missing = [];
const workoutSizes = [];

for (const [programName, program] of Object.entries(PROGRAMS)) {
  for (const [dayName, workout] of Object.entries(program.workouts)) {
    workoutSizes.push(workout.length);
    for (const [exerciseName] of workout) {
      if (!libraryNames.has(exerciseName)) missing.push(`${programName} / ${dayName} / ${exerciseName}`);
    }
  }
}

assert(Object.keys(PROGRAMS).length >= 10, 'Minst tio program krävs');
assert(EX.length >= 100, 'Övningsbiblioteket ska ha minst 100 övningar');
assert(Math.min(...workoutSizes) >= 10, 'Varje pass ska ha minst tio övningar');
assert(Math.max(...workoutSizes) <= 15, 'Inget pass ska ha fler än femton övningar');
assert.deepEqual(missing, [], `Programövningar saknas i biblioteket: ${missing.join(', ')}`);
assert.equal(new Set(EX.map(exercise => exercise[0])).size, EX.length, 'Övningsnamn måste vara unika');
assert(html.includes("K='rsg_ai_complete_v1'"), 'Den befintliga datanyckeln måste bevaras');
assert(html.includes('serviceWorker.register'), 'Service worker-registrering saknas');
assert(html.includes('exerciseSwaps'), 'Beständiga övningsbyten saknas');
assert(html.includes('workoutDrafts'), 'Beständiga passutkast saknas');
assert(index.includes('./Coash%201.0.html'), 'Rotadressen måste öppna den befintliga appfilen');
assert(fs.existsSync(path.join(root, '.nojekyll')), '.nojekyll saknas för GitHub Pages');

const appVersion = html.match(/const APP_VERSION='([^']+)'/)?.[1];
const workerVersion = serviceWorker.match(/const VERSION = '([^']+)'/)?.[1];
assert(appVersion, 'Appversion saknas');
assert.equal(workerVersion, appVersion, 'App och service worker måste ha samma version');
assert(serviceWorker.includes("'./index.html'"), 'Rotfilen saknas i app-cachen');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifest.start_url, './Coash%201.0.html');
for (const asset of ['index.html', '.nojekyll', 'service-worker.js', 'icon-192.png', 'icon-512.png']) {
  assert(fs.existsSync(path.join(root, asset)), `${asset} saknas`);
}

console.log(`OK: ${Object.keys(PROGRAMS).length} program, ${EX.length} övningar, ${Math.min(...workoutSizes)}–${Math.max(...workoutSizes)} övningar/pass.`);
