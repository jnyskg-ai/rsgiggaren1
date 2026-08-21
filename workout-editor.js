/* RSG Coach 4.10.0 — persistent per-workout exercise and set editing. */
(() => {
  'use strict';

  const EDITOR_VERSION = '4.10.0';
  const DEFAULT_ADDED_SETS = 3;
  const MAX_SETS = 20;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const normalisedName = value => String(value || '').toLocaleLowerCase('sv-SE');

  function ensureEditorStores() {
    if (!D.workoutEdits || typeof D.workoutEdits !== 'object' || Array.isArray(D.workoutEdits)) D.workoutEdits = {};
    if (!D.exerciseOrder || typeof D.exerciseOrder !== 'object' || Array.isArray(D.exerciseOrder)) D.exerciseOrder = {};
  }

  const editKey = () => JSON.stringify([D.program, currentDay]);
  const orderKey = () => JSON.stringify([D.program, currentDay]);

  function normaliseEdit(edit) {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) edit = {};
    if (!Array.isArray(edit.added)) edit.added = [];
    if (!Array.isArray(edit.removedSlots)) edit.removedSlots = [];
    if (!edit.setCounts || typeof edit.setCounts !== 'object' || Array.isArray(edit.setCounts)) edit.setCounts = {};
    edit.added = edit.added.filter(item => item && Number.isFinite(+item.slot) && exerciseInfo(item.name));
    edit.removedSlots = [...new Set(edit.removedSlots.map(Number).filter(Number.isFinite))];
    return edit;
  }

  function currentEdit(create = false) {
    ensureEditorStores();
    const key = editKey();
    if (!D.workoutEdits[key] && !create) return { added: [], removedSlots: [], setCounts: {} };
    D.workoutEdits[key] = normaliseEdit(D.workoutEdits[key]);
    return D.workoutEdits[key];
  }

  function hasEditContent(edit = currentEdit(false)) {
    return Boolean(edit.added.length || edit.removedSlots.length || Object.keys(edit.setCounts).length);
  }

  function cleanupCurrentEdit(edit) {
    if (!hasEditContent(edit)) delete D.workoutEdits[editKey()];
  }

  function applyWorkoutEdits(rows, edit = currentEdit(false)) {
    edit = normaliseEdit(edit);
    const removed = new Set(edit.removedSlots.map(Number));
    const output = rows
      .filter(row => !removed.has(Number(row[4])))
      .map(row => {
        const copy = [...row];
        const slot = String(Number(row[4]));
        const count = +edit.setCounts[slot];
        if (own(edit.setCounts, slot) && Number.isFinite(count)) {
          copy[1] = Math.max(1, Math.min(MAX_SETS, Math.round(count)));
          copy[5] = true;
        }
        return copy;
      });

    edit.added.forEach(item => {
      const slot = Number(item.slot);
      const info = exerciseInfo(item.name);
      if (!info || output.some(row => Number(row[4]) === slot)) return;
      const storedCount = +edit.setCounts[String(slot)];
      const count = own(edit.setCounts, String(slot)) && Number.isFinite(storedCount)
        ? storedCount
        : +item.sets || DEFAULT_ADDED_SETS;
      const selected = D.exerciseSwaps[swapKey(slot)] || item.name;
      output.push([
        selected,
        Math.max(1, Math.min(MAX_SETS, Math.round(count))),
        item.reps || info[4] || '8–12',
        item.name,
        slot,
        true
      ]);
    });
    return output;
  }

  ensureEditorStores();
  const nativeWorkoutRows = workoutRows;
  workoutRows = function editableWorkoutRows() {
    return applyWorkoutEdits(nativeWorkoutRows());
  };

  function nextAddedSlot(edit) {
    const used = new Set(edit.added.map(item => Number(item.slot)));
    let slot = Date.now();
    while (used.has(slot)) slot += 1;
    return slot;
  }

  function currentDraftExercises() {
    return D.workoutDrafts[draftKey()]?.exercises;
  }

  function trimDraft(slot, count) {
    const draft = currentDraftExercises();
    const exercise = draft?.[String(slot)];
    if (exercise?.sets) exercise.sets = exercise.sets.slice(0, count);
  }

  function removeDraftExercise(slot) {
    const draft = currentDraftExercises();
    if (draft) delete draft[String(slot)];
  }

  function changeSetCount(exercise, direction) {
    const slot = Number(exercise.dataset.slot);
    const current = exercise.querySelectorAll('.set').length;
    const next = current + direction;
    if (next < 1) return toast('Minst ett set måste finnas kvar');
    if (next > MAX_SETS) return toast(`Max ${MAX_SETS} set per övning`);

    const lastSet = [...exercise.querySelectorAll('.set')].at(-1);
    const lastHasData = direction < 0 && lastSet && (
      lastSet.querySelector('.kg')?.value ||
      lastSet.querySelector('.reps')?.value ||
      lastSet.querySelector('button')?.classList.contains('done')
    );
    if (lastHasData && !confirm('Ta bort sista setet och det du har fyllt i där?')) return;

    saveWorkoutDraft();
    const edit = currentEdit(true);
    edit.setCounts[String(slot)] = next;
    if (direction < 0) trimDraft(slot, next);
    save();
    workout();
    toast(direction > 0 ? 'Ett set lades till' : 'Ett set togs bort');
  }

  function removeExercise(exercise) {
    const slot = Number(exercise.dataset.slot);
    const name = exercise.dataset.name;
    if (!confirm(`Ta bort ${name} från det här passet? Ändringen sparas även till nästa gång.`)) return;

    saveWorkoutDraft();
    const edit = currentEdit(true);
    const addedIndex = edit.added.findIndex(item => Number(item.slot) === slot);
    if (addedIndex >= 0) edit.added.splice(addedIndex, 1);
    else if (!edit.removedSlots.includes(slot)) edit.removedSlots.push(slot);
    delete edit.setCounts[String(slot)];
    delete D.exerciseSwaps[swapKey(slot)];
    removeDraftExercise(slot);
    if (Array.isArray(D.exerciseOrder[orderKey()])) {
      D.exerciseOrder[orderKey()] = D.exerciseOrder[orderKey()].filter(value => Number(value) !== slot);
    }
    cleanupCurrentEdit(edit);
    save();
    workout();
    toast(`${name} togs bort`);
  }

  function restoreRemovedExercise(name, edit) {
    const base = activeProgram().workouts[currentDay] || [];
    const wanted = normalisedName(name);
    const slot = base.findIndex((row, index) => normalisedName(row[0]) === wanted && edit.removedSlots.includes(index));
    if (slot < 0) return false;
    edit.removedSlots = edit.removedSlots.filter(value => Number(value) !== slot);
    cleanupCurrentEdit(edit);
    return true;
  }

  function addExercise(name) {
    const info = exerciseInfo(name);
    if (!info) return toast('Övningen finns inte i biblioteket');
    if (workoutRows().some(row => normalisedName(row[0]) === normalisedName(name))) return toast('Övningen finns redan i passet');

    saveWorkoutDraft();
    const edit = currentEdit(true);
    const restored = restoreRemovedExercise(name, edit);
    if (!restored) {
      edit.added.push({
        slot: nextAddedSlot(edit),
        name: info[0],
        sets: DEFAULT_ADDED_SETS,
        reps: info[4] || '8–12'
      });
    }
    save();
    closeAddExercise();
    workout();
    toast(restored ? `${name} återställdes` : `${name} lades till`);
  }

  function resetWorkoutEdits() {
    const edit = currentEdit(false);
    if (!hasEditContent(edit)) return;
    if (!confirm('Återställa övningar och set till programmets original för det här passet?')) return;

    saveWorkoutDraft();
    edit.added.forEach(item => {
      delete D.exerciseSwaps[swapKey(Number(item.slot))];
      removeDraftExercise(Number(item.slot));
    });
    delete D.workoutEdits[editKey()];
    delete D.exerciseOrder[orderKey()];
    save();
    workout();
    toast('Originalpasset är återställt');
  }

  function updateEditorToolbar() {
    const reset = document.querySelector('#resetWorkoutEdits');
    if (reset) reset.hidden = !hasEditContent();
  }

  function decorateWorkoutEditor() {
    const list = document.querySelector('#exerciseList');
    if (!list) return;
    const exercises = [...document.querySelectorAll('#exerciseList .exercise')];
    if (!exercises.length) {
      if (!workoutRows().length) list.innerHTML = '<div class="empty-workout"><b>Passet har inga övningar.</b><br>Lägg till en övning för att fortsätta.</div>';
      return;
    }

    exercises.forEach(exercise => {
      const actions = exercise.querySelector('.exercise-actions');
      if (actions && !actions.querySelector('.remove-exercise')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn smallbtn remove-exercise';
        button.textContent = '×';
        button.title = 'Ta bort övningen';
        button.setAttribute('aria-label', `Ta bort ${exercise.dataset.name}`);
        button.onclick = event => { event.preventDefault(); removeExercise(exercise); };
        actions.append(button);
      }

      if (!exercise.querySelector('.set-edit-actions')) {
        const controls = document.createElement('div');
        controls.className = 'set-edit-actions';
        controls.innerHTML = '<button class="btn smallbtn remove-set" type="button">− Ta bort set</button><button class="btn secondary add-set" type="button">+ Lägg till set</button>';
        controls.querySelector('.remove-set').onclick = event => { event.preventDefault(); changeSetCount(exercise, -1); };
        controls.querySelector('.add-set').onclick = event => { event.preventDefault(); changeSetCount(exercise, 1); };
        exercise.append(controls);
      }
    });
  }

  const nativeWorkout = workout;
  workout = function editableWorkout() {
    nativeWorkout();
    updateEditorToolbar();
    decorateWorkoutEditor();
  };

  function renderAddExerciseResults() {
    const search = normalisedName(document.querySelector('#addExerciseSearch')?.value);
    const muscle = document.querySelector('#addExerciseMuscle')?.value || '';
    const currentNames = new Set(workoutRows().map(row => normalisedName(row[0])));
    const matches = EX.filter(info =>
      (!search || normalisedName(info[0]).includes(search) || normalisedName(info[1]).includes(search)) &&
      (!muscle || info[1] === muscle)
    ).slice(0, 40);
    const results = document.querySelector('#addExerciseResults');
    if (!results) return;
    results.innerHTML = matches.length
      ? matches.map(info => {
        const active = currentNames.has(normalisedName(info[0]));
        return `<div class="add-exercise-item"><div><b>${esc(info[0])}</b><small>${esc(info[1])} • ${esc(info[2])} • ${esc(info[4])}</small></div><button class="btn ${active ? 'smallbtn' : 'primary'}" type="button" data-workout-add="${esc(info[0])}" ${active ? 'disabled' : ''}>${active ? 'Tillagd' : '+ Lägg till'}</button></div>`;
      }).join('')
      : '<div class="empty-workout">Ingen övning matchar sökningen.</div>';
    results.querySelectorAll('[data-workout-add]:not([disabled])').forEach(button => {
      button.onclick = () => addExercise(button.dataset.workoutAdd);
    });
  }

  function openAddExercise() {
    const modal = document.querySelector('#addExerciseModal');
    if (!modal) return;
    const muscleSelect = document.querySelector('#addExerciseMuscle');
    if (muscleSelect && muscleSelect.options.length === 1) {
      [...new Set(EX.map(info => info[1]))].sort((a, b) => a.localeCompare(b, 'sv')).forEach(muscle => muscleSelect.add(new Option(muscle, muscle)));
    }
    document.querySelector('#addExerciseSearch').value = '';
    if (muscleSelect) muscleSelect.value = '';
    renderAddExerciseResults();
    modal.classList.add('on');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.querySelector('#addExerciseSearch')?.focus(), 50);
  }

  function closeAddExercise() {
    document.querySelector('#addExerciseModal')?.classList.remove('on');
    document.body.style.overflow = '';
  }

  document.querySelector('#addWorkoutExercise').onclick = openAddExercise;
  document.querySelector('#resetWorkoutEdits').onclick = resetWorkoutEdits;
  document.querySelector('#closeAddExercise').onclick = closeAddExercise;
  document.querySelector('#addExerciseSearch').oninput = renderAddExerciseResults;
  document.querySelector('#addExerciseMuscle').onchange = renderAddExerciseResults;
  document.querySelector('#addExerciseModal').onclick = event => {
    if (event.target === document.querySelector('#addExerciseModal')) closeAddExercise();
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.querySelector('#addExerciseModal').classList.contains('on')) closeAddExercise();
  });

  globalThis.RSG_WORKOUT_EDITOR_TEST = Object.freeze({
    version: EDITOR_VERSION,
    applyWorkoutEdits,
    hasEditContent
  });

  save();
  render();
})();
