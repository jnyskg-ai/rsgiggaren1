/* RSG Coach 4.10.0 — muscle-block ordering + per-workout custom order.
 * This module loads after the main app script and can also be injected by the
 * service worker as a fallback for an older cached HTML shell.
 * It never changes the canonical exercise slot index, so swaps, drafts,
 * history and weight recommendations continue to use their existing keys.
 */
(() => {
  'use strict';

  const ORDER_VERSION = '4.10.0';
  const ensureOrderStore = () => {
    if (!D.exerciseOrder || typeof D.exerciseOrder !== 'object' || Array.isArray(D.exerciseOrder)) D.exerciseOrder = {};
  };
  ensureOrderStore();

  const orderKey = () => JSON.stringify([D.program, currentDay]);
  const norm = value => String(value || '').toLocaleLowerCase('sv-SE');

  function muscleBlock(name) {
    const n = norm(name);
    const info = exerciseInfo(name);
    const muscle = info?.[1] || '';
    if (/shrug|farmers carry|farmer/.test(n)) return 'traps';
    if (/adduktor/.test(n)) return 'adductors';
    if (/abduktor|sidogång band|frog pump/.test(n)) return 'abductors';
    if (muscle === 'Axlar') {
      if (/omvänd|bakre axel|face pull|sidolyft|upprätt rodd/.test(n)) return 'rearSideDelts';
      return 'frontDelts';
    }
    if (muscle === 'Bröst') return 'chest';
    if (muscle === 'Rygg') return 'back';
    if (muscle === 'Triceps') return 'triceps';
    if (muscle === 'Biceps') return 'biceps';
    if (muscle === 'Underarmar') return 'forearms';
    if (muscle === 'Framsida lår') return 'quads';
    if (muscle === 'Baksida lår') return 'hamstrings';
    if (muscle === 'Säte') return 'glutes';
    if (muscle === 'Vader') return 'calves';
    if (muscle === 'Mage') return 'core';
    return 'other';
  }

  const rankMap = groups => Object.fromEntries(groups.map((group, index) => [group, index * 10]));
  function defaultPolicy() {
    const day = norm(currentDay);
    const program = norm(D.program);

    // Requested bodybuilding block order.
    if (/push/.test(day)) return rankMap(['chest','frontDelts','triceps','rearSideDelts','traps','biceps','forearms','other']);
    if (/pull|rygg/.test(day)) return rankMap(['back','rearSideDelts','biceps','traps','forearms','frontDelts','triceps','other']);

    // Other splits still keep every muscle group together.
    if (/bröst.*rygg|bröst & rygg/.test(day)) return rankMap(['chest','back','frontDelts','rearSideDelts','triceps','biceps','traps','forearms','other']);
    if (/axlar.*arm|armar/.test(day) || /armspecialisering/.test(program)) return rankMap(['frontDelts','rearSideDelts','triceps','biceps','forearms','traps','chest','back','other']);
    if (/quads|framsida/.test(day)) return rankMap(['quads','glutes','hamstrings','abductors','adductors','calves','core','other']);
    if (/baksida|posterior/.test(day)) return rankMap(['hamstrings','glutes','quads','abductors','adductors','calves','core','other']);
    if (/rumpa|glute/.test(day) || /glute|curves/.test(program)) return rankMap(['glutes','abductors','quads','hamstrings','adductors','calves','core','back','frontDelts','rearSideDelts','triceps','biceps','other']);
    if (/ben|legs|lower|extremiteter/.test(day)) return rankMap(['quads','hamstrings','glutes','abductors','adductors','calves','core','triceps','biceps','forearms','other']);
    if (/upper|torso|överkropp/.test(day)) return rankMap(['chest','back','frontDelts','rearSideDelts','triceps','biceps','traps','forearms','core','other']);
    if (/helkropp|full body|pass [abc]/.test(day)) return rankMap(['quads','hamstrings','glutes','chest','back','frontDelts','rearSideDelts','triceps','biceps','traps','forearms','calves','core','other']);
    if (/bröst/.test(day)) return rankMap(['chest','frontDelts','triceps','rearSideDelts','other']);
    if (/axlar/.test(day)) return rankMap(['frontDelts','rearSideDelts','traps','triceps','biceps','other']);
    return rankMap(['chest','back','frontDelts','rearSideDelts','triceps','biceps','traps','forearms','quads','hamstrings','glutes','abductors','adductors','calves','core','other']);
  }

  function defaultSortedRows(rows) {
    const policy = defaultPolicy();
    return rows.map((row, originalPosition) => ({row, originalPosition, block: muscleBlock(row[0])}))
      .sort((a,b) => (policy[a.block] ?? 999) - (policy[b.block] ?? 999) || a.originalPosition - b.originalPosition)
      .map(item => item.row);
  }

  const nativeWorkoutRows = workoutRows;
  workoutRows = function orderedWorkoutRows() {
    const base = nativeWorkoutRows();
    const defaults = defaultSortedRows(base);
    ensureOrderStore();
    const saved = D.exerciseOrder[orderKey()];
    if (!Array.isArray(saved) || !saved.length) return defaults;

    const bySlot = new Map(base.map(row => [Number(row[4]), row]));
    const result = [], used = new Set();
    saved.forEach(slot => {
      const numericSlot = Number(slot), row = bySlot.get(numericSlot);
      if (row && !used.has(numericSlot)) { result.push(row); used.add(numericSlot); }
    });
    defaults.forEach(row => { const slot = Number(row[4]); if (!used.has(slot)) result.push(row); });
    return result;
  };

  function saveCurrentOrder(rows) {
    ensureOrderStore();
    D.exerciseOrder[orderKey()] = rows.map(row => Number(row[4]));
    save();
  }

  function moveExercise(slot, direction) {
    saveWorkoutDraft();
    const rows = workoutRows().slice();
    const index = rows.findIndex(row => Number(row[4]) === Number(slot));
    const target = index + direction;
    if (index < 0 || target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    saveCurrentOrder(rows);
    workout();
    toast(direction < 0 ? 'Övningen flyttades upp' : 'Övningen flyttades ned');
  }

  function resetCurrentOrder() {
    saveWorkoutDraft();
    ensureOrderStore();
    delete D.exerciseOrder[orderKey()];
    save();
    workout();
    toast('Standardordningen är återställd');
  }

  function ensureOrderToolbar() {
    const list = document.querySelector('#exerciseList');
    if (!list) return;
    let toolbar = document.querySelector('#exerciseOrderTools');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'exerciseOrderTools';
      toolbar.className = 'why';
      toolbar.style.margin = '8px 0 12px';
      list.parentNode.insertBefore(toolbar, list);
    }
    const custom = Array.isArray(D.exerciseOrder?.[orderKey()]) && D.exerciseOrder[orderKey()].length > 0;
    toolbar.innerHTML = `<div class="row"><div><b>Övningsordning</b><small>${custom ? 'Din egen ordning är sparad för det här passet.' : 'Muskelgrupperna ligger samlade i standardordning.'}</small></div><button class="btn smallbtn" id="resetExerciseOrder" type="button" ${custom ? '' : 'disabled'}>Återställ</button></div>`;
    const reset = document.querySelector('#resetExerciseOrder');
    if (reset) reset.onclick = resetCurrentOrder;
  }

  function decorateExerciseOrderButtons() {
    const exercises = [...document.querySelectorAll('#exerciseList .exercise')];
    exercises.forEach((exercise, index) => {
      const actions = exercise.querySelector('.exercise-actions');
      if (!actions || actions.querySelector('.order-up')) return;

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'btn smallbtn order-up';
      up.textContent = '↑';
      up.title = 'Flytta övningen upp';
      up.setAttribute('aria-label', `Flytta ${exercise.dataset.name} upp`);
      up.disabled = index === 0;
      up.onclick = event => { event.preventDefault(); moveExercise(exercise.dataset.slot, -1); };

      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'btn smallbtn order-down';
      down.textContent = '↓';
      down.title = 'Flytta övningen ned';
      down.setAttribute('aria-label', `Flytta ${exercise.dataset.name} ned`);
      down.disabled = index === exercises.length - 1;
      down.onclick = event => { event.preventDefault(); moveExercise(exercise.dataset.slot, 1); };

      actions.prepend(down);
      actions.prepend(up);
    });
  }

  const nativeWorkout = workout;
  workout = function orderedWorkout() {
    nativeWorkout();
    ensureOrderToolbar();
    decorateExerciseOrderButtons();
  };

  const nativeRender = render;
  render = function orderedRender() {
    nativeRender();
    const version = document.querySelector('#appVersion');
    if (version) version.textContent = `RSG Coach ${ORDER_VERSION} • dataschema ${DATA_SCHEMA}`;
    ensureOrderToolbar();
    decorateExerciseOrderButtons();
  };

  const saveWorkoutButton = document.querySelector('#saveWorkout');
  if (saveWorkoutButton?.onclick) {
    const nativeSaveWorkout = saveWorkoutButton.onclick;
    saveWorkoutButton.onclick = function saveWorkoutWithCurrentVersion(event) {
      const before = D.sessions.length;
      nativeSaveWorkout.call(this, event);
      if (D.sessions.length > before) {
        const session = D.sessions.at(-1);
        if (session) session.appVersion = ORDER_VERSION;
        save();
      }
    };
  }

  save();
  render();
})();
