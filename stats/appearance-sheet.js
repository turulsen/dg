/* Appearance on the character sheet (#cs-appearance-fieldset): a step of
   the creation wizard, so a new player describes their Agent while
   they're making them, instead of finding the Agent File's Appearance
   brief later. Only the looks a sheet can't work out (face, eyes, hair,
   posture, expression, how the person feels in a room); name, age, sex,
   nationality, build and outfit already reach the Agent File from the
   sheet (agent-portal-export.js).

   Saved straight to the Agent File (briefs/{code}, merge) -- the same
   fields Agent Hub's Appearance section edits, so there is one copy.
   Typed before the Agent has a code (early in the wizard) it waits and
   goes when the wizard finishes. Loading an Agent's sheet loads their
   Appearance from the Agent File. */
(function () {
  var root = document.getElementById('cs-appearance-fieldset');
  if (!root) return;
  var status = document.getElementById('cs-appearance-status');
  var pending = {};
  var timer = null;
  var loadedFor = '';

  // stats/ profession keys -> the generator's archetypes, so a random
  // fill suits the job (assets/appearance-gen.js).
  var ARCHETYPE = {
    federal_agent: 'fed', police_officer: 'cop', special_operator: 'mil', soldier_marine: 'soldier',
    physician: 'doc', nurse_paramedic: 'medic', anthropologist: 'academic', scientist: 'scientist',
    intelligence_analyst: 'spook', intelligence_case_officer: 'caseofficer', criminal: 'criminal',
    media_specialist: 'reporter', lawyer_executive: 'lawyer', pilot_sailor: 'pilot',
    computer_scientist: 'engineer', foreign_service: 'fso', firefighter: 'firefighter', program_manager: 'program'
  };

  function code() { try { return (localStorage.getItem('dg_stats_cloud_code') || '').trim().toUpperCase(); } catch (e) { return ''; } }
  function inputs() { return Array.prototype.slice.call(root.querySelectorAll('[data-ap]')); }
  function say(msg) { if (status) status.textContent = msg || ''; }
  function missing() {
    return inputs().filter(function (el) { return el.hasAttribute('data-ap-required') && !el.value.trim(); }).length;
  }
  function sayState(saved) {
    var n = missing();
    say((saved ? 'Saved to the Agent File. ' : '') + (n ? n + ' still blank.' : 'All filled in.'));
  }

  function flush() {
    clearTimeout(timer);
    var c = code();
    if (!c || !window.dgStore || !Object.keys(pending).length) return Promise.resolve(false);
    var patch = pending;
    pending = {};
    patch.agent_code = c;
    return window.dgStore.updateBrief(c, patch).then(function () { sayState(true); return true; }, function (err) {
      // Try again with the next change (or the wizard's finish).
      Object.keys(patch).forEach(function (k) { if (k !== 'agent_code' && !(k in pending)) pending[k] = patch[k]; });
      say('Not saved yet -- check your connection.');
      console.warn('appearance: not saved to the Agent File', err);
      return false;
    });
  }
  function queue(el) {
    pending[el.getAttribute('data-ap')] = el.value.trim();
    clearTimeout(timer);
    timer = setTimeout(flush, 1200);
  }
  root.addEventListener('input', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-ap')) queue(e.target);
  });

  document.getElementById('cs-appearance-random').addEventListener('click', function () {
    var G = window.dgAppearanceGen;
    if (!G) return;
    var sexRaw = ((document.getElementById('cs-bio-sex') || {}).value || '').trim().toLowerCase();
    var want = /^f/.test(sexRaw) ? 'Female' : /^m/.test(sexRaw) ? 'Male' : '';
    var prof = ((document.getElementById('cs-profession-select') || {}).value || '');
    var a = G.generate(ARCHETYPE[prof] || null);
    // Facial hair and hair style come from per-sex tables.
    for (var i = 0; want && a.sex !== want && i < 40; i++) a = G.generate(ARCHETYPE[prof] || null);
    inputs().forEach(function (el) {
      var k = el.getAttribute('data-ap');
      if (el.value.trim() || !a[k]) return; // never overwrite what's written
      el.value = a[k];
      queue(el);
    });
    sayState(false);
  });

  // The Agent's Appearance from their Agent File, when the sheet loads them.
  function load(c, force) {
    if (!c || !window.dgStore || (!force && c === loadedFor)) return;
    loadedFor = c;
    window.dgStore.getBrief(c).then(function (b) {
      if (!b || code() !== c) return;
      inputs().forEach(function (el) {
        var k = el.getAttribute('data-ap');
        if (b[k] && !(k in pending)) el.value = b[k];
      });
      sayState(false);
    }, function () { /* offline: the fields stay as they are */ });
  }
  function clear() {
    pending = {};
    loadedFor = '';
    inputs().forEach(function (el) { el.value = ''; });
    say('');
  }

  window.dgAppearanceSheet = {
    load: function () { load(code(), true); },
    clear: clear,
    flush: flush,
    missing: missing
  };
  // A finished wizard is a new Agent: give them their Agent File now
  // (name, age, sex, nationality, build and outfit from the sheet -- the
  // sheet's own export, which never touches these Appearance fields),
  // then what was described here.
  window.addEventListener('dg-wizard-finished', function () {
    try { if (window.dgAgentPortalExport) window.dgAgentPortalExport.run(); } catch (e) { /* best effort */ }
    flush();
  });
  // A code that appears mid-wizard (Biography names the Agent) gets
  // what was typed before it.
  window.addEventListener('storage', function (e) { if (e.key === 'dg_stats_cloud_code') load(code(), false); });
  setTimeout(function () { load(code(), false); }, 600);
})();
