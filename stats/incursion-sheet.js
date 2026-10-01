/* The Incursion on the character sheet (#cs-incursion-fieldset): the
   picker from assets/incursion.js, kept in the hidden #cs-incursion so
   collectState()/applyState() save it with the rest of the sheet, and
   also written to the Agent's own record (characters/{code}.incursion)
   so the Agent File, the Standing Orders briefing and A-Cell can read it,
   and the Handler can amend it there. The sheet's autosave never touches
   that field (saveCharacter() merges), so a Handler's edit is not undone
   by a player who still has the sheet open; the next load takes it. */
(function () {
  var host = document.getElementById('cs-incursion-picker');
  var hid = document.getElementById('cs-incursion');
  if (!host || !hid || !window.dgIncursion) return;
  var I = window.dgIncursion;
  var pushTimer = null;
  function code() { try { return localStorage.getItem('dg_stats_cloud_code') || ''; } catch (e) { return ''; } }
  function push(v) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      var c = code();
      if (c && window.dgStore && window.dgStore.saveIncursion) {
        window.dgStore.saveIncursion(c, v, 'player').catch(function (err) { console.warn('incursion: not saved to the Agent record', err); });
      }
    }, 1200);
  }
  var api = I.mount(host, null, {
    onChange: function (v) {
      hid.value = JSON.stringify(v);
      // The sheet's own autosave and cloud sync ride on change events.
      hid.dispatchEvent(new Event('change', { bubbles: true }));
      push(v);
    }
  });
  window.dgIncursionSheet = {
    set: function (v) {
      var n = v ? I.normalize(v) : null;
      hid.value = n ? JSON.stringify(n) : '';
      api.set(n);
    },
    get: function () { return api.get(); },
    // An Incursion written before the Agent had a code (early in the
    // wizard) reaches the Agent's record once creation is finished.
    pushNow: function () {
      var c = code(), v = api.get();
      if (!c || !I.textOf(v) || !window.dgStore || !window.dgStore.saveIncursion) return Promise.resolve(false);
      return window.dgStore.saveIncursion(c, v, 'player').then(function () { return true; }, function () { return false; });
    }
  };
  window.addEventListener('dg-wizard-finished', function () { window.dgIncursionSheet.pushNow(); });
})();
