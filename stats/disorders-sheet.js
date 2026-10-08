/* Mental Disorders on the character sheet: their own list, apart from
   Motivations (they used to share one free-text box). Each row picks a
   disorder from the Rules reference's list (assets/disorders.js) -- its
   trigger and effect shown under it -- or "Other…" for one the Handler
   made up. Kept in the hidden #cs-disorders as a JSON array of names so
   collectState()/applyState() save it with the rest of the sheet (as
   bio.disorders). Drawn in the sheet's Biography and in Live Play, which
   edit the same list. */
(function () {
  'use strict';
  var D = window.dgDisorders;
  var hid = document.getElementById('cs-disorders');
  var mainHost = document.getElementById('cs-disorders-list');
  if (!D || !hid || !mainHost) return;

  // rows: [{ v: 'PTSD' | 'what the Handler wrote', other: bool }]
  var rows = [];
  var hosts = [mainHost];
  var OTHER = '__other';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function values() { return rows.map(function (r) { return String(r.v || '').trim(); }).filter(Boolean); }

  function rowHtml(r, i) {
    var known = !r.other && D.find(r.v);
    var sel = r.other ? OTHER : (known ? known.name : '');
    var opts = '<option value="">Choose a disorder…</option>' + D.list.map(function (d) {
      return '<option value="' + esc(d.name) + '"' + (sel === d.name ? ' selected' : '') + '>' + esc(d.name) + '</option>';
    }).join('') + '<option value="' + OTHER + '"' + (r.other ? ' selected' : '') + '>Other…</option>';
    var info = known ? D.describe(known.name) : (r.other ? 'Not on the list: describe it, and its trigger, with your Handler.' : '');
    return '<div class="cs-dis-row" data-dis="' + i + '">' +
      '<div class="cs-dis-line"><select class="cs-dis-select" aria-label="Mental disorder ' + (i + 1) + '">' + opts + '</select>' +
      '<button type="button" class="cs-dis-del" aria-label="Remove this disorder" title="Remove">×</button></div>' +
      (r.other ? '<input type="text" class="cs-dis-other" placeholder="Name the disorder" aria-label="Disorder not on the list" value="' + esc(r.v) + '" autocomplete="off">' : '') +
      (info ? '<div class="cs-dis-info">' + esc(info) + '</div>' : '') +
      '</div>';
  }

  function draw(host) {
    host.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<div class="cs-dis-none">None. A disorder can come from reaching the Breaking Point.</div>';
  }
  function drawAll(except) {
    hosts = hosts.filter(function (h) { return h === mainHost || h.isConnected; });
    hosts.forEach(function (h) { if (h !== except) draw(h); });
  }
  function save() {
    hid.value = JSON.stringify(values());
    // The sheet's autosave and Live Play sync ride on change events.
    hid.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function wire(host) {
    if (host._dgDisWired) return;
    host._dgDisWired = true;
    host.addEventListener('change', function (e) {
      var row = e.target.closest('[data-dis]');
      if (!row || !e.target.classList.contains('cs-dis-select')) return;
      var r = rows[+row.getAttribute('data-dis')];
      if (!r) return;
      if (e.target.value === OTHER) { r.other = true; if (D.find(r.v)) r.v = ''; }
      else { r.other = false; r.v = e.target.value; }
      save();
      drawAll();
      if (r.other) {
        var inp = host.querySelector('[data-dis="' + rows.indexOf(r) + '"] .cs-dis-other');
        if (inp) inp.focus();
      }
    });
    host.addEventListener('input', function (e) {
      if (!e.target.classList.contains('cs-dis-other')) return;
      var row = e.target.closest('[data-dis]');
      var r = row && rows[+row.getAttribute('data-dis')];
      if (!r) return;
      r.v = e.target.value;
      save();
      drawAll(host);  // not under the cursor
    });
    host.addEventListener('click', function (e) {
      var b = e.target.closest('.cs-dis-del');
      if (!b) return;
      var row = b.closest('[data-dis]');
      rows.splice(+row.getAttribute('data-dis'), 1);
      save();
      drawAll();
    });
  }

  function add() {
    rows.push({ v: '', other: false });
    drawAll();
    hosts.forEach(function (h) {
      if (!h.offsetParent) return;
      var sels = h.querySelectorAll('.cs-dis-select');
      if (sels.length) sels[sels.length - 1].focus();
    });
  }

  function set(list, opts) {
    rows = (Array.isArray(list) ? list : []).filter(function (x) { return String(x || '').trim(); })
      .map(function (x) { var k = D.find(x); return { v: k ? k.name : String(x).trim(), other: !k }; });
    hid.value = JSON.stringify(values());
    drawAll();
    if (!(opts && opts.quiet)) hid.dispatchEvent(new Event('change', { bubbles: true }));
  }

  wire(mainHost);
  draw(mainHost);
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-dis-add]')) add();
  });

  window.dgDisordersSheet = {
    set: set,
    get: values,
    add: add,
    // Live Play's copy of the list: drawn into its (rebuilt) sheet once.
    mount: function (host) {
      if (!host || host._dgDisWired) return;
      hosts.push(host);
      wire(host);
      draw(host);
    }
  };
})();
