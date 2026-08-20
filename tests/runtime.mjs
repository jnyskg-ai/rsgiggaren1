import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor(selector) {
    this.selector = selector;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.options = selector === '#muscleFilter' || selector === '#equipmentFilter' ? [{}] : [];
    this.files = [];
    this.children = [];
    this.classList = new FakeClassList();
    this.hidden = false;
  }
  add(option) { this.options.push(option); }
  insertAdjacentHTML(_position, html) { this.innerHTML += html; }
  querySelector(selector) { return getElement(`${this.selector} ${selector}`); }
  querySelectorAll() { return []; }
  closest() { return this; }
  remove() {}
}

const elements = new Map();
function getElement(selector) {
  if (!elements.has(selector)) elements.set(selector, new FakeElement(selector));
  return elements.get(selector);
}

const storage = new Map();
const localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
const document = {
  querySelector: getElement,
  querySelectorAll: () => [],
  body: getElement('body'),
  addEventListener() {}
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'Coash 1.0.html'), 'utf8');
const appScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(appScript, 'Appens scriptblock saknas');

const expose = `
globalThis.__RSG_TEST__={
  get data(){return D},
  normaliseData,
  defaultRestSeconds,
  exerciseAlternatives,
  workoutRows,
  startTimer,
  finishTimer,
  setCurrentDay(value){currentDay=value}
};`;
const context = vm.createContext({
  console,
  document,
  localStorage,
  navigator: {},
  location: { protocol: 'http:', reload() {} },
  Option: class { constructor(text, value) { this.text = text; this.value = value; } },
  URL,
  Blob,
  Intl,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  scrollTo() {},
  confirm() { return false; }
});
vm.runInContext(`${appScript}\n${expose}`, context, { filename: 'Coash 1.0.html' });

const api = context.__RSG_TEST__;
assert(api, 'Testgränssnittet kunde inte skapas');
assert.equal((elements.get('#exerciseList').innerHTML.match(/class="exercise"/g) || []).length, 13, 'Upper A ska rendera tretton övningar');
assert(elements.get('#exerciseList').innerHTML.includes('swap-select'), 'Väljaren för övningsalternativ renderades inte');
assert(elements.get('#programLibrary').innerHTML.includes('Benspecialisering 5'), 'Programbiblioteket renderades inte komplett');
assert(elements.get('#exerciseLibrary').innerHTML.includes('141 övningar hittades'), 'Det stora övningsbiblioteket renderades inte');
assert.equal(elements.get('#appVersion').textContent, 'RSG Coach 4.7.1 • dataschema 3');

assert.equal(api.defaultRestSeconds('Bänkpress', '5–8'), 180, 'Tung press ska ge tre minuters vila');
assert.equal(api.defaultRestSeconds('Sidolyft hantlar', '12–25'), 60, 'Isolationsövning ska ge en minuts vila');
assert(api.exerciseAlternatives('Bänkpress', 'Bänkpress').some(exercise => exercise[0] === 'Hantelpress plan bänk'), 'Bröstalternativ saknas');

api.setCurrentDay('Upper A');
api.data.exerciseSwaps[JSON.stringify(['Upper/Lower', 'Upper A', 0])] = 'Hantelpress plan bänk';
assert.equal(api.workoutRows()[0][0], 'Hantelpress plan bänk', 'Beständigt övningsbyte applicerades inte');

const migrated = api.normaliseData({ profile: { name: 'Befintlig' }, sessions: [{ marker: 'bevarad' }] });
assert.equal(migrated.schemaVersion, 3);
assert.equal(migrated.profile.name, 'Befintlig');
assert.equal(migrated.sessions[0].marker, 'bevarad');
assert.equal(Object.keys(migrated.exerciseSwaps).length, 0);

api.startTimer(180, 'Bänkpress');
const beforeExtension = JSON.parse(localStorage.getItem('rsg_ai_rest_timer_v2')).endAt;
elements.get('#addTimer').onclick();
const afterExtension = JSON.parse(localStorage.getItem('rsg_ai_rest_timer_v2')).endAt;
assert.equal(afterExtension - beforeExtension, 30000, 'Timerförlängningen ska vara exakt 30 sekunder');
assert(elements.get('#timer').classList.contains('on'), 'Timern visas inte efter start');
api.finishTimer(false);
assert.equal(localStorage.getItem('rsg_ai_rest_timer_v2'), null, 'Stoppad timer ska rensas');

console.log('OK: initial rendering, träningsprogram, bibliotek, alternativ, datamigrering och timerlogik.');
