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
const mediaScript = fs.readFileSync(path.join(root, 'exercise-media.js'), 'utf8');

assert(script, 'Appens scriptblock saknas');
new Function(script);

const dataSource = html.slice(html.indexOf('const W='), html.indexOf('const CARDIO='));
const { PROGRAMS, EX } = new Function(`${dataSource};return {PROGRAMS,EX}`)();
const mediaGlobal = Object.create(null);
const exerciseMedia = new Function('globalThis', `${mediaScript};return globalThis.RSG_EXERCISE_MEDIA`)(mediaGlobal);
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
assert.equal(Object.keys(exerciseMedia).length, EX.length, 'Varje övning måste ha ett explicit mediebeslut');
assert.deepEqual(EX.map(exercise => exercise[0]).filter(name => !Object.hasOwn(exerciseMedia, name)), [], 'Mediekartan saknar övningar');
assert(Object.values(exerciseMedia).filter(Boolean).length >= 120, 'Minst 120 övningar ska ha verifierade bildpar');
assert(Object.values(exerciseMedia).filter(Boolean).every(entry => Array.isArray(entry) && ['free', 'repdb'].includes(entry[0]) && entry[1]), 'Medieposter måste ha verifierad källa och id');
assert(['Renegade row', 'Farmers carry', 'Goblet squat', 'Sissy squat', 'Donkey calf raise', 'Enbens vadpress'].every(name => exerciseMedia[name] === null), 'Varianter med fel redskap eller belastning får inte återanvända närliggande bilder');
assert.deepEqual(exerciseMedia['T-bar rodd'], ['free', 'Lying_T-Bar_Row'], 'T-bar rodd ska visa den maskinvariant som övningsbiblioteket anger');
assert.deepEqual(exerciseMedia['Rumänska marklyft hantlar'], ['repdb', 'dumbbell-romanian-deadlift'], 'Hantel-RDL får inte ersättas av ett stiff-legged deadlift');
assert(html.includes("K='rsg_ai_complete_v1'"), 'Den befintliga datanyckeln måste bevaras');
assert(html.includes('serviceWorker.register'), 'Service worker-registrering saknas');
assert(html.includes('exerciseSwaps'), 'Beständiga övningsbyten saknas');
assert(html.includes('workoutDrafts'), 'Beständiga passutkast saknas');
assert(html.includes('weightRecommendation'), 'Historikbaserad viktrekommendation saknas');
assert(html.includes('setNumber:index+1'), 'Setnummer måste sparas för exakt viktminne per set');
assert(!html.includes('function guideSvg'), 'Den gamla gissade streckgubbsgeneratorn får inte finnas kvar');
assert(html.includes('Ingen gissad bild visas'), 'Guidefallback för ej verifierade varianter saknas');
assert(index.includes('./Coash%201.0.html'), 'Rotadressen måste öppna den befintliga appfilen');
assert(fs.existsSync(path.join(root, '.nojekyll')), '.nojekyll saknas för GitHub Pages');

const appVersion = html.match(/const APP_VERSION='([^']+)'/)?.[1];
const workerVersion = serviceWorker.match(/const VERSION = '([^']+)'/)?.[1];
assert(appVersion, 'Appversion saknas');
assert.equal(workerVersion, appVersion, 'App och service worker måste ha samma version');
assert(serviceWorker.includes("'./index.html'"), 'Rotfilen saknas i app-cachen');
assert(serviceWorker.includes("'./exercise-media.js'"), 'Den explicita mediekartan saknas i app-cachen');
assert(serviceWorker.includes("raw.githubusercontent.com"), 'Cache för visade guidebilder saknas');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifest.start_url, './Coash%201.0.html');
for (const asset of ['index.html', '.nojekyll', 'service-worker.js', 'exercise-media.js', 'icon-192.png', 'icon-512.png']) {
  assert(fs.existsSync(path.join(root, asset)), `${asset} saknas`);
}

console.log(`OK: ${Object.keys(PROGRAMS).length} program, ${EX.length} övningar, ${Math.min(...workoutSizes)}–${Math.max(...workoutSizes)} övningar/pass.`);
