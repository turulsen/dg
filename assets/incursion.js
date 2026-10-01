/* The Incursion -- what brought the Agent to Delta Green. One source for
   the tables and the picker used by the character sheet (and its
   creation wizard), the standalone the-incursion.html, Field Notes'
   Agent File and A-Cell's Handler view.

   A value is { picks: { environment, vector, cover, complication,
   incursion } (1-based table rows, 0 = not chosen), text, custom }.
   `text` is what happened, in words: built from the picks until the
   player writes their own (`custom`), freehand or mixed with picks.

     dgIncursion.TABLES / ORDER / DIE / LABEL
     dgIncursion.compose(picks)            -> sentence from whatever is picked
     dgIncursion.roll(key)                 -> 1..die
     dgIncursion.textOf(value)             -> the text to show ('' if none)
     dgIncursion.mount(el, value, { onChange }) -> picker; returns { get, set }
*/
(function () {
  var TABLES = {
    environment: [
      'Urban', 'Suburban or exurban', 'Rural', 'Wilderness or ocean'
    ],
    vector: [
      'A lone wolf', 'A family cult', 'A militant or corrupted religious sect',
      'A linguistic or historical discovery', 'A scientific or technological discovery',
      'A bystander exposed accidentally'
    ],
    cover: [
      'Violent crime across state lines or on federal property', 'Terrorism',
      'Theft or fraud', 'Drug trafficking', 'Environmental crime', 'Kidnapping',
      'Natural disaster', 'Plane, train, or ship disaster or disappearance'
    ],
    complication: [
      'Your Agent was badly hurt', 'Witness audio, video, or photos went online',
      'Journalists had to be misled', 'First responders were hurt or killed',
      'Bystanders were hurt or killed', 'Professional blowback',
      'Legal or criminal repercussions', 'Part of the threat escaped',
      'Evidence went to a non-Delta Green lab',
      'Your Agent does not remember some of what happened'
    ],
    incursion: [
      '…feeding on human flesh and blood', '…feeding on psychic energies',
      '…reproducing', '…seeking servants', '…studying humanity',
      '…taking physical form through human infestation',
      '…seeking contact with an unnatural entity',
      '…utilizing an unnatural artifact or device',
      '…performing an unnatural ritual', '…transforming into something unnatural',
      '…psychically possessed', '…studying the remnants of an unnatural incursion'
    ]
  };
  var ORDER = ['environment', 'vector', 'cover', 'complication', 'incursion'];
  var DIE = { environment: 4, vector: 6, cover: 8, complication: 10, incursion: 12 };
  var LABEL = { environment: 'Environment', vector: 'Vector', cover: 'Cover Story', complication: 'Complication', incursion: 'Incursion' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function roll(key) { return Math.floor(Math.random() * DIE[key]) + 1; }
  function pick(picks, key) {
    var n = parseInt(picks && picks[key], 10);
    return n >= 1 && n <= TABLES[key].length ? TABLES[key][n - 1] : '';
  }
  function article(word) { return /^[aeiou]/i.test(word) ? 'an' : 'a'; }

  // The same sentence the-incursion.html has always built from a full
  // roll, and a sensible part of it when only some lines are chosen.
  function compose(picks) {
    // Only the first letter drops to lower case, so names like "Delta
    // Green" keep their capitals mid-sentence.
    var lc = function (t) { return t ? t.charAt(0).toLowerCase() + t.slice(1) : ''; };
    var env = pick(picks, 'environment'), vec = pick(picks, 'vector'), cov = pick(picks, 'cover');
    var comp = pick(picks, 'complication'), inc = pick(picks, 'incursion');
    var out = [];
    var where = env ? article(env.toLowerCase()) + ' ' + env.toLowerCase() + ' setting' : '';
    if (vec || inc) {
      var what = (vec ? lc(vec) : 'something') + ' led to an unnatural entity or human being' + (inc ? ' ' + inc.replace('…', '') : '') + '.';
      out.push(where ? 'In ' + where + ', ' + what : what.charAt(0).toUpperCase() + what.slice(1));
    } else if (where) {
      out.push('It happened in ' + where + '.');
    }
    if (cov) out.push('Delta Green covered it up as ' + lc(cov) + '.');
    if (comp) out.push('During the incident, ' + lc(comp) + '.');
    return out.join(' ');
  }
  function empty() { return { picks: { environment: 0, vector: 0, cover: 0, complication: 0, incursion: 0 }, text: '', custom: false }; }
  function normalize(v) {
    var out = empty();
    if (!v) return out;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return Object.assign(out, { text: v, custom: !!v }); } }
    ORDER.forEach(function (k) { var n = parseInt(v.picks && v.picks[k], 10); out.picks[k] = n > 0 ? n : 0; });
    out.text = String(v.text || '');
    out.custom = !!v.custom;
    return out;
  }
  function textOf(v) {
    v = normalize(v);
    return (v.text || compose(v.picks) || '').trim();
  }

  var CSS = '' +
    '.dg-inc{ display:flex; flex-direction:column; gap:8px; }' +
    '.dg-inc-row{ display:grid; grid-template-columns:110px minmax(0,1fr) auto; gap:8px; align-items:center; }' +
    '.dg-inc-row label{ font-size:.82em; letter-spacing:.08em; text-transform:uppercase; opacity:.75; }' +
    '.dg-inc select, .dg-inc textarea{ font:inherit; color:inherit; background:transparent; min-width:0; width:100%;' +
      ' border:1px solid; border-color:color-mix(in srgb, currentColor 35%, transparent); border-radius:3px; padding:5px 7px; box-sizing:border-box; }' +
    '.dg-inc select option{ color:#1c1608; background:#f4eed8; }' +
    '.dg-inc textarea{ min-height:84px; resize:vertical; line-height:1.5; }' +
    '.dg-inc button{ font:inherit; font-size:.82em; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; color:inherit; background:transparent;' +
      ' border:1px solid; border-color:color-mix(in srgb, currentColor 45%, transparent); border-radius:3px; padding:5px 9px; width:auto; margin:0; }' +
    '.dg-inc button:hover{ border-color:currentColor; }' +
    '.dg-inc-actions{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; }' +
    '.dg-inc-text-l{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-size:.82em; letter-spacing:.08em; text-transform:uppercase; opacity:.75; margin-top:4px; }' +
    '.dg-inc-hint{ text-transform:none; letter-spacing:0; opacity:.8; }' +
    '@media (max-width:520px){ .dg-inc-row{ grid-template-columns:minmax(0,1fr) auto; } .dg-inc-row label{ grid-column:1 / -1; } }';
  function ensureCss() {
    if (document.getElementById('dg-inc-css')) return;
    var st = document.createElement('style');
    st.id = 'dg-inc-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // The picker: roll everything, roll or choose any one line (mix and
  // match), and/or write it freehand. Untouched, the text follows the
  // picks; once the player writes their own it stays theirs until they
  // ask to rewrite it from the picks.
  function mount(el, value, opts) {
    opts = opts || {};
    ensureCss();
    var v = normalize(value);
    el.innerHTML = '<div class="dg-inc">' +
      ORDER.map(function (k) {
        return '<div class="dg-inc-row"><label for="dg-inc-' + k + '-' + (mount.n = (mount.n || 0) + 1) + '">' + LABEL[k] + '</label>' +
          '<select data-inc="' + k + '" id="dg-inc-' + k + '-' + mount.n + '"><option value="0">— not set —</option>' +
          TABLES[k].map(function (t, i) { return '<option value="' + (i + 1) + '">' + (i + 1) + ' · ' + esc(t) + '</option>'; }).join('') +
          '</select><button type="button" data-inc-roll="' + k + '" title="Roll 1D' + DIE[k] + ' for this line">D' + DIE[k] + '</button></div>';
      }).join('') +
      '<div class="dg-inc-actions"><button type="button" data-inc-all>Roll all</button><button type="button" data-inc-clear>Clear</button></div>' +
      '<div class="dg-inc-text-l"><span>What happened</span><span class="dg-inc-hint" data-inc-hint></span></div>' +
      '<textarea data-inc-text placeholder="Pick or roll the lines above, or write it yourself."></textarea>' +
      '<div class="dg-inc-actions"><button type="button" data-inc-rebuild hidden>Rewrite from the lines above</button></div>' +
      '</div>';
    var q = function (s) { return el.querySelector(s); };
    var ta = q('[data-inc-text]');
    function paint() {
      ORDER.forEach(function (k) { q('[data-inc="' + k + '"]').value = String(v.picks[k] || 0); });
      if (!v.custom) v.text = compose(v.picks);
      if (document.activeElement !== ta) ta.value = v.text;
      q('[data-inc-rebuild]').hidden = !v.custom || !compose(v.picks);
      q('[data-inc-hint]').textContent = v.custom ? 'your own words' : (v.text ? 'from the lines above — edit freely' : '');
    }
    function changed() { paint(); if (opts.onChange) opts.onChange(normalize(v)); }
    el.querySelector('.dg-inc').addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-inc');
      if (!k) return;
      v.picks[k] = parseInt(e.target.value, 10) || 0;
      changed();
    });
    el.querySelector('.dg-inc').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-inc-roll')) { var k = b.getAttribute('data-inc-roll'); v.picks[k] = roll(k); }
      else if (b.hasAttribute('data-inc-all')) ORDER.forEach(function (k) { v.picks[k] = roll(k); });
      else if (b.hasAttribute('data-inc-clear')) { v = empty(); ta.value = ''; }
      else if (b.hasAttribute('data-inc-rebuild')) { v.custom = false; ta.value = ''; }
      else return;
      changed();
    });
    ta.addEventListener('input', function () {
      v.text = ta.value;
      v.custom = !!ta.value.trim() && ta.value.trim() !== compose(v.picks);
      q('[data-inc-rebuild]').hidden = !v.custom || !compose(v.picks);
      q('[data-inc-hint]').textContent = v.custom ? 'your own words' : (ta.value ? 'from the lines above — edit freely' : '');
      if (opts.onChange) opts.onChange(normalize(v));
    });
    paint();
    return {
      get: function () { return normalize(v); },
      set: function (nv) { v = normalize(nv); ta.value = v.text; paint(); }
    };
  }

  window.dgIncursion = {
    TABLES: TABLES, ORDER: ORDER, DIE: DIE, LABEL: LABEL,
    compose: compose, roll: roll, textOf: textOf, normalize: normalize, mount: mount, empty: empty
  };
})();
