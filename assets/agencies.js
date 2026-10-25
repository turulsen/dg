/* The cover agencies that have a Field ID card on file (v3.9.0) -- one
   list for the Employer drop-down (New Recruit's Personal data and the
   Agent File's Edit mode), the notebook's Field ID card and the Field
   ID Fabricator. `code` is the agency's key in assets/field-id-cards.js.

     dgAgencies.list                    [{code, abbr, name, title, alias}]
     dgAgencies.match(text)             the agency an employer names, or null
     dgAgencies.split(employer)         {code|'' , other, unit}
     dgAgencies.compose(code, other, unit) -> the employer string saved
     dgAgencies.pickerHtml(employer, cls) / wire(root)
       the drop-down + "Which agency?" + "Office / unit", keeping a
       hidden input (data-emp-out) in step; the page's own data-f /
       data-e attribute goes on that hidden input. */
(function () {
  if (window.dgAgencies) return;
  // Grouped for the drop-downs (v3.9.4); matched in this order, so the
  // broad ones (DHS) come after the agencies under them.
  var GROUPS = ['Federal law enforcement', 'Intelligence', 'Homeland security & response', 'Science & civil', 'State & local', 'Fictional'];
  var LIST = [
    { code: 'FBI', abbr: 'FBI', name: 'Federal Bureau of Investigation', title: 'Special Agent', group: 0 },
    { code: 'DEA', abbr: 'DEA', name: 'Drug Enforcement Administration', title: 'Special Agent', group: 0 },
    { code: 'ATF', abbr: 'ATF', name: 'Bureau of Alcohol, Tobacco, Firearms and Explosives', title: 'Special Agent', group: 0 },
    { code: 'USMS', abbr: 'USMS', name: 'U.S. Marshals Service', title: 'Deputy U.S. Marshal', alias: ['marshal'], group: 0 },
    { code: 'DOJIG', abbr: 'DOJ OIG', name: 'DOJ Office of Inspector General', title: 'Special Agent', alias: ['inspector general'], group: 0 },
    { code: 'SECRET', abbr: 'USSS', name: 'U.S. Secret Service', title: 'Special Agent', alias: ['secret service', 'usss'], group: 0 },
    { code: 'ICE', abbr: 'ICE', name: 'Immigration and Customs Enforcement', title: 'Special Agent', alias: ['immigration'], group: 0 },
    { code: 'CBP', abbr: 'CBP', name: 'Customs and Border Protection', title: 'Officer', alias: ['border patrol', 'customs'], group: 0 },
    { code: 'NCIS', abbr: 'NCIS', name: 'Naval Criminal Investigative Service', title: 'Special Agent', group: 0 },
    { code: 'FINCEN', abbr: 'FinCEN', name: 'Financial Crimes Enforcement Network', title: 'Analyst', alias: ['fincen'], group: 0 },
    { code: 'USPI', abbr: 'USPIS', name: 'U.S. Postal Inspection Service', title: 'Postal Inspector', alias: ['postal', 'uspis'], group: 0 },
    { code: 'IRSCI', abbr: 'IRS-CI', name: 'IRS Criminal Investigation', title: 'Special Agent', alias: ['internal revenue', 'irs'], group: 0 },
    { code: 'NSA', abbr: 'NSA', name: 'National Security Agency', title: 'Analyst', alias: ['national security agency'], group: 1 },
    { code: 'CIA', abbr: 'CIA', name: 'Central Intelligence Agency', title: 'Operations Officer', alias: ['central intelligence'], group: 1 },
    { code: 'DIA', abbr: 'DIA', name: 'Defense Intelligence Agency', title: 'Intelligence Officer', alias: ['defense intelligence'], group: 1 },
    { code: 'NGA', abbr: 'NGA', name: 'National Geospatial-Intelligence Agency', title: 'Imagery Analyst', alias: ['geospatial', 'imagery and mapping'], group: 1 },
    { code: 'NRO', abbr: 'NRO', name: 'National Reconnaissance Office', title: 'Program Officer', alias: ['reconnaissance office'], group: 1 },
    { code: 'ONI', abbr: 'ONI', name: 'Office of Naval Intelligence', title: 'Intelligence Specialist', alias: ['naval intelligence'], group: 1 },
    { code: 'USCG', abbr: 'USCG', name: 'U.S. Coast Guard', title: 'Petty Officer', alias: ['coast guard'], group: 2 },
    { code: 'DHS', abbr: 'DHS', name: 'Department of Homeland Security', title: 'Special Agent', alias: ['homeland security'], since: '00s', group: 2 },
    { code: 'NASA', abbr: 'NASA', name: 'NASA', title: 'Civil Servant', alias: ['aeronautics and space'], group: 3 },
    { code: 'NYPD', abbr: 'NYPD', name: 'New York City Police Department', title: 'Detective', alias: ['new york police'], group: 4 },
    { code: 'SCSO', abbr: 'SCSO', name: "Shelby County Sheriff's Office", title: 'Deputy', alias: ['shelby county'], group: 4 },
    { code: 'MEPIC', abbr: 'M-EPIC', name: 'M-EPIC Environmental Policy Impact Commission', title: 'Investigator', alias: ['m-epic', 'environmental policy'], group: 5 }
  ];
  var SEP = ' — ';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function byCode(c) { return LIST.filter(function (a) { return a.code === c; })[0] || null; }
  function rx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // The agency an employer string names: its code or abbreviation as a
  // word, its full name, or one of its aliases.
  function match(text) {
    var t = String(text || '').toLowerCase();
    if (!t) return null;
    for (var i = 0; i < LIST.length; i++) {
      var a = LIST[i];
      if (new RegExp('\\b' + rx(a.code.toLowerCase()) + '\\b').test(t) || new RegExp('(^|[^a-z])' + rx(a.abbr.toLowerCase()) + '([^a-z]|$)').test(t) || t.indexOf(a.name.toLowerCase()) !== -1) return a;
      if ((a.alias || []).some(function (x) { return t.indexOf(x) !== -1; })) return a;
    }
    return null;
  }
  // "ATF Special Response Team" -> ATF + unit "Special Response Team";
  // "Bureau of ... Explosives — Special Response Team" likewise; a name
  // not on file stays whole as "other".
  function split(employer) {
    var e = String(employer || '').trim(), a = match(e);
    if (!e) return { code: '', other: '', unit: '' };
    if (!a) return { code: '', other: e, unit: '' };
    var rest = e;
    var k = rest.indexOf(SEP);
    if (k !== -1 && rest.slice(0, k).toLowerCase() === a.name.toLowerCase()) rest = rest.slice(k + SEP.length);
    else {
      [a.name, a.abbr, a.code].forEach(function (w) { rest = rest.replace(new RegExp('(^|\\s)' + rx(w) + '(?=\\s|$|[,(])', 'i'), ' '); });
      rest = rest.replace(/^[\s,\-—()]+|[\s,\-—()]+$/g, '');
      // Something only an alias matched (e.g. "Border Patrol (BORTAC)"):
      // keep all of it as the unit.
      if (rest && rest.toLowerCase() === e.toLowerCase()) rest = e;
    }
    return { code: a.code, other: '', unit: rest };
  }
  function compose(code, other, unit) {
    var a = byCode(code), u = String(unit || '').trim();
    if (!a) return String(other || '').trim();
    return a.name + (u ? SEP + u : '');
  }
  function noteHtml(code, other) {
    var a = byCode(code);
    if (a) return '✓ Field ID: ' + esc(a.abbr) + ' credential, filled in for you.';
    if (String(other || '').trim()) return 'No ID card on file for this one: the Field ID shows the Program’s own card.';
    return '';
  }
  // Grouped <option>s, filtered by a search (name, abbreviation, code,
  // aliases, group); `extra` adds rows after the groups.
  function hit(a, q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return true;
    return [a.name, a.abbr, a.code, GROUPS[a.group]].concat(a.alias || []).join(' ').toLowerCase().indexOf(q) !== -1;
  }
  function optionsHtml(selected, q, extra) {
    var out = '';
    GROUPS.forEach(function (g, gi) {
      var rows = LIST.filter(function (a) { return a.group === gi && (hit(a, q) || a.code === selected); });
      if (!rows.length) return;
      out += '<optgroup label="' + esc(g) + '">' + rows.map(function (a) { return '<option value="' + a.code + '"' + (a.code === selected ? ' selected' : '') + '>' + esc(a.name) + (a.abbr !== a.name ? ' (' + esc(a.abbr) + ')' : '') + '</option>'; }).join('') + '</optgroup>';
    });
    return out + (extra || '');
  }
  // The picker. `cls` is the page's input class (e.g. "in" or "ap-in");
  // `outAttr` is the page's own binding (e.g. 'data-f="bio.employer"').
  function pickerHtml(employer, cls, outAttr, labels) {
    var s = split(employer), L = labels || {};
    var isOther = !s.code && !!s.other;
    var opts = '<option value=""' + (!s.code && !isOther ? ' selected' : '') + '>—</option>' +
      optionsHtml(s.code, '', '<option value="__other"' + (isOther ? ' selected' : '') + '>Other…</option>');
    css();
    return '<div class="dg-emp">' +
      '<label>' + (L.employer || 'Employer') + '<span class="dg-emp-pick"><input class="' + cls + ' dg-emp-q" data-emp="q" type="search" placeholder="Search agencies…" aria-label="Search agencies" autocomplete="off">' +
        '<select class="' + cls + '" data-emp="sel" aria-label="Employer">' + opts + '</select></span></label>' +
      '<label class="dg-emp-other"' + (isOther ? '' : ' hidden') + '>' + (L.other || 'Which agency?') + '<input class="' + cls + '" data-emp="other" value="' + esc(s.other) + '" placeholder="e.g. National Security Agency"></label>' +
      '<label class="dg-emp-unit"' + (isOther ? ' hidden' : '') + '>' + (L.unit || 'Office / unit (optional)') + '<input class="' + cls + '" data-emp="unit" value="' + esc(s.unit) + '" placeholder="e.g. Kansas City Field Office"></label>' +
      '<input type="hidden" data-emp-out ' + (outAttr || '') + ' value="' + esc(employer || '') + '">' +
      '<div class="dg-emp-note" style="grid-column:1/-1;font-size:11.5px;opacity:.72;margin-top:-2px">' + noteHtml(s.code, s.other) + '</div></div>';
  }
  // The picker's parts sit in the page's own form grid; [hidden] must win
  // over the page's label display rule.
  function css() {
    if (document.getElementById('dg-emp-css')) return;
    var st = document.createElement('style');
    st.id = 'dg-emp-css';
    st.textContent = '.dg-emp{display:contents}.dg-emp [hidden]{display:none!important}.dg-emp-pick{display:flex;flex-direction:column;gap:4px}.dg-emp-q{font-size:12px!important;padding:4px 8px!important}';
    document.head.appendChild(st);
  }
  function sync(box, fire) {
    var sel = box.querySelector('[data-emp="sel"]'), oth = box.querySelector('[data-emp="other"]'), unit = box.querySelector('[data-emp="unit"]'), out = box.querySelector('[data-emp-out]');
    var v = sel.value, isOther = v === '__other';
    box.querySelector('.dg-emp-other').hidden = !isOther;
    box.querySelector('.dg-emp-unit').hidden = isOther || !v;
    var emp = isOther ? oth.value : compose(v, '', unit.value);
    var note = box.querySelector('.dg-emp-note');
    if (note) note.innerHTML = noteHtml(isOther ? '' : v, isOther ? oth.value : '');
    if (out && out.value !== emp) {
      out.value = emp;
      if (fire) out.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  // Typing in the search narrows the drop-down; a single match is chosen.
  function filterBox(box, q) {
    var sel = box.querySelector('[data-emp="sel"]'), cur = sel.value;
    var matches = LIST.filter(function (a) { return hit(a, q); });
    var keep = String(q || '').trim() && matches.length === 1 ? matches[0].code : cur;
    sel.innerHTML = '<option value="">—</option>' + optionsHtml(keep === '__other' ? '' : keep, q, '<option value="__other">Other…</option>');
    sel.value = keep;
    if (keep !== cur) sync(box, true);
  }
  // Delegated, once per root: any picker inside it keeps its hidden
  // input in step and fires 'input' on it, which the page already
  // listens for (setPath / applyEdit).
  function wire(root) {
    if (!root || root._dgEmpWired) return;
    root._dgEmpWired = true;
    function on(e) {
      var t = e.target;
      if (!t.getAttribute || !t.getAttribute('data-emp')) return;
      e.stopPropagation();
      var box = t.closest('.dg-emp');
      if (t.getAttribute('data-emp') === 'q') { if (box) filterBox(box, t.value); return; }
      if (box) sync(box, true);
      if (t.getAttribute('data-emp') === 'sel' && t.value === '__other') { var o = box.querySelector('[data-emp="other"]'); if (o) o.focus(); }
    }
    root.addEventListener('input', on, true);
    root.addEventListener('change', on, true);
  }
  window.dgAgencies = { list: LIST, groups: GROUPS, hit: hit, optionsHtml: optionsHtml, byCode: byCode, match: match, split: split, compose: compose, pickerHtml: pickerHtml, wire: wire };
})();
