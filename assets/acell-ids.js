/* A-Cell's ID Creator (v3.9.0): the Handler makes an ID for an NPC (an
   agency credential, a card or badge from the evidence packs, or a
   company that never existed) and files it to a Cell as Evidence: a
   picture, unreleased until the Handler releases it, with the Evidence
   tab's tags, sharing and Gallery like any other.

   Also where the evidence-pack stock is loaded: the pictures are paid
   products, so they live in Storage id-templates/ (signed-in reads
   only), never in the repo. Upload them once here.

   Needs window.dgAcellApi (a-cell.html), assets/field-id-cards.js,
   assets/agencies.js and assets/forge-cards.js. */
(function () {
  if (window.dgAcellIds) return;
  var H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  var root = null, F = null, A = null;
  var S = { stock: null, stockErr: '', cells: [], ops: [], kind: 'office', tpl: 'sheriff', agency: 'FBI', era: '20s',
    fields: {}, entity: null, photo: '', busy: '', msg: '', cell: '', op: '', title: '' };
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function api() { return window.dgAcellApi; }

  /* ── Stock: list and upload (Storage id-templates/) ── */
  function listStock() {
    return api().handler().then(function (fb) {
      var st = fb.storage();
      var one = function (ref) { return ref.listAll(); };
      return one(st.ref('id-templates')).then(function (res) {
        var faces = (res.prefixes || []).filter(function (p) { return p.name === 'faces'; })[0];
        return (faces ? one(faces).then(function (r) { return res.items.concat(r.items); }) : Promise.resolve(res.items));
      }).then(function (items) {
        return Promise.all(items.map(function (it) { return it.getDownloadURL().then(function (u) { return [it.fullPath.replace(/^id-templates\//, ''), u]; }, function () { return null; }); }));
      }).then(function (pairs) { var m = {}; pairs.forEach(function (p) { if (p) m[p[0]] = p[1]; }); return m; });
    });
  }
  function refreshStock() {
    S.stockErr = '';
    return listStock().then(function (m) { S.stock = m; render(); }, function (e) { S.stock = {}; S.stockErr = (e && e.message) || String(e); render(); });
  }
  // A file goes where its name says: face-*.jpg under faces/, a design's
  // own file name (sheriff.jpg, badge-oregon.png, ...) at the top.
  function uploadStock(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var known = {}; F.REFS.forEach(function (r) { known[r.file] = 1; });
    S.busy = 'Uploading ' + list.length + ' file' + (list.length > 1 ? 's' : '') + '…'; render();
    api().handler().then(function (fb) {
      return Promise.all(list.map(function (f) {
        var name = f.name.toLowerCase().replace(/\s+/g, '-');
        var path = /^face/.test(name) ? 'id-templates/faces/' + name : 'id-templates/' + name;
        return fb.storage().ref(path).put(f, { contentType: f.type || 'image/jpeg' }).then(function () { return known[name] || /^face/.test(name) ? '' : name; });
      }));
    }).then(function (odd) {
      odd = odd.filter(Boolean);
      S.busy = ''; S.msg = 'Uploaded.' + (odd.length ? ' Not a known design name (kept, unused): ' + odd.join(', ') : '');
      if (window.dgStore && window.dgStore.forgetIdTemplates) window.dgStore.forgetIdTemplates();
      return refreshStock();
    }, function (e) { S.busy = ''; S.msg = 'Upload failed: ' + ((e && e.message) || e); render(); });
  }
  function faces() { return Object.keys(S.stock || {}).filter(function (k) { return /^faces\//.test(k); }).sort(); }

  /* ── Cells and Operations, for filing ── */
  function loadLists() {
    return Promise.all([api().get('list_cells'), api().get('list_operations')]).then(function (r) {
      S.cells = ((r[0] && r[0].cells) || []).slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      S.ops = (r[1] && r[1].operations) || [];
      if (!S.cell && S.cells[0]) S.cell = S.cells[0].cell_id;
      render();
    });
  }

  /* ── The card being made ── */
  function card() {
    if (S.kind === 'mirror') return { proto: 'mirror', agency: S.agency, era: S.era, fields: S.fields };
    if (S.kind === 'entity') return S.entity;
    return { proto: 'office', tpl: S.tpl, fields: S.fields };
  }
  function resetFields() {
    S.fields = {};
    if (S.kind === 'office') {
      F.ref(S.tpl).fields.forEach(function (x) { S.fields[x.k] = x.opts ? x.opts[0] : x.roll ? F.roll[x.roll]('') : ''; });
    } else if (S.kind === 'mirror') {
      var a = A.byCode(S.agency);
      S.fields = { name: '', title: a ? a.title : 'Agent', id_num: F.roll.badge() + '-' + F.roll.badge(), expiry: '12/2027', detail: '', era: S.era };
    } else if (!S.entity) {
      var k = F.KINDS[Math.floor(Math.random() * F.KINDS.length)], org = F.roll.company(k.key);
      S.entity = { proto: 'entity', org: org, kind: k.key, tag: k.tags[0], layout: 'rule', name: '', title: k.titles[0], phone: F.roll.phone(), mail: F.roll.mail(org, '', k.key), logo: F.logoChoices(org, k.key, 0, 0)[0] };
    }
  }
  function nameOf() { return S.kind === 'entity' ? (S.entity && S.entity.name) : S.fields.name; }
  function randomLook() {
    if (S.kind === 'office') {
      var ok = F.REFS.filter(function (r) { return S.stock && S.stock[r.file]; });
      if (ok.length) { var keep = S.fields.name; S.tpl = ok[Math.floor(Math.random() * ok.length)].key; resetFields(); S.fields.name = keep; }
    } else if (S.kind === 'mirror') {
      S.agency = A.list[Math.floor(Math.random() * A.list.length)].code; var n = S.fields.name; resetFields(); S.fields.name = n;
    } else {
      var e = S.entity, k = F.kind(e.kind), b = Math.floor(Math.random() * 40);
      e.layout = F.LAYOUTS[Math.floor(Math.random() * F.LAYOUTS.length)].key;
      e.logo = F.logoChoices(e.org, e.kind, b, Math.floor(Math.random() * 10))[0];
      e.title = k.titles[Math.floor(Math.random() * k.titles.length)];
    }
    render();
  }

  /* ── Drawing ── */
  function refUrl(f) { return (S.stock || {})[f] || ''; }
  function cardHtml(print) { return F.render(card(), { photo: S.photo, refUrl: refUrl, print: print }); }
  function render() {
    if (!root || !F) return;
    var refs = F.REFS, have = refs.filter(function (r) { return S.stock && S.stock[r.file]; }).length, fc = faces().length;
    var f = S.fields;
    var form = '';
    if (S.kind === 'office') {
      form = '<label class="idc-l">Design<select data-k="tpl">' + refs.map(function (r) { return '<option value="' + r.key + '"' + (r.key === S.tpl ? ' selected' : '') + (S.stock && !S.stock[r.file] ? ' disabled' : '') + '>' + esc(r.label) + (S.stock && !S.stock[r.file] ? ' (not uploaded)' : '') + '</option>'; }).join('') + '</select></label>' +
        F.ref(S.tpl).fields.map(function (x) {
          return '<label class="idc-l">' + esc(x.label) + (x.opts ? '<input data-f="' + x.k + '" list="idc-dl-' + x.k + '" value="' + esc(f[x.k] || '') + '" placeholder="pick or type your own"><datalist id="idc-dl-' + x.k + '">' + x.opts.map(function (o) { return '<option value="' + esc(o) + '">'; }).join('') + '</datalist>'
            : '<span class="idc-row"><input data-f="' + x.k + '" value="' + esc(f[x.k] || '') + '">' + (x.roll ? '<button type="button" class="paper-btn" data-a="roll" data-k="' + x.k + '" data-r="' + x.roll + '" title="Roll">⚄</button>' : '') + '</span>') + '</label>';
        }).join('');
    } else if (S.kind === 'mirror') {
      form = '<label class="idc-l">Agency<select data-k="agency">' + A.list.map(function (a) { return '<option value="' + a.code + '"' + (a.code === S.agency ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '<option value="DG"' + (S.agency === 'DG' ? ' selected' : '') + '>Delta Green — Directorate</option></select></label>' +
        '<label class="idc-l">Era<select data-k="era">' + [['90s', '1990s'], ['00s', '2000s'], ['10s', '2010s'], ['20s', '2020s']].map(function (e) { return '<option value="' + e[0] + '"' + (e[0] === S.era ? ' selected' : '') + '>' + e[1] + '</option>'; }).join('') + '</select></label>' +
        [['name', 'Name'], ['title', 'Title'], ['id_num', 'ID number'], ['expiry', 'Expires'], ['detail', 'Office / badge / rank']].map(function (x) { return '<label class="idc-l">' + x[1] + '<input data-f="' + x[0] + '" value="' + esc(f[x[0]] || '') + '"></label>'; }).join('');
    } else {
      var e = S.entity;
      form = '<label class="idc-l">Company<span class="idc-row"><input data-e="org" value="' + esc(e.org) + '"><button type="button" class="paper-btn" data-a="roll-org" title="Invent one">⚄</button></span></label>' +
        '<label class="idc-l">Kind<select data-e="kind">' + F.KINDS.map(function (k) { return '<option value="' + k.key + '"' + (k.key === e.kind ? ' selected' : '') + '>' + esc(k.label) + '</option>'; }).join('') + '</select></label>' +
        '<label class="idc-l">Layout<select data-e="layout">' + F.LAYOUTS.map(function (L) { return '<option value="' + L.key + '"' + (L.key === e.layout ? ' selected' : '') + '>' + esc(L.label) + '</option>'; }).join('') + '</select></label>' +
        [['name', 'Name'], ['title', 'Title'], ['tag', 'Tagline'], ['phone', 'Phone'], ['mail', 'E-mail']].map(function (x) { return '<label class="idc-l">' + x[1] + '<input data-e="' + x[0] + '" value="' + esc(e[x[0]] || '') + '"></label>'; }).join('') +
        '<div class="idc-l">Logo<span class="idc-logos">' + F.logoChoices(e.org, e.kind, S.logoBatch || 0, 0).map(function (l, i) { return '<button type="button" class="idc-logo" data-a="logo" data-i="' + i + '">' + F.logo(l) + '</button>'; }).join('') +
        '<button type="button" class="paper-btn" data-a="logo-more">⟳</button></span></div>';
    }
    var cellOpts = S.cells.map(function (x) { return '<option value="' + esc(x.cell_id) + '"' + (x.cell_id === S.cell ? ' selected' : '') + '>' + esc(x.name || x.cell_id) + '</option>'; }).join('');
    var opOpts = '<option value="">No Operation</option>' + S.ops.filter(function (o) { return !S.cell || o.cell_id === S.cell; }).map(function (o) { return '<option value="' + esc(o.operation_id) + '"' + (o.operation_id === S.op ? ' selected' : '') + '>' + esc(o.name || o.operation_id) + '</option>'; }).join('');
    root.innerHTML =
      '<div class="idc-stock"><b>Evidence-pack stock</b> · ' + (S.stock ? have + ' of ' + refs.length + ' designs, ' + fc + ' faces on file' : (S.stockErr ? 'could not list: ' + esc(S.stockErr) : 'checking…')) +
        ' <label class="paper-btn idc-up">⇪ Upload stock<input type="file" multiple accept="image/png,image/jpeg" data-a="upload" hidden></label>' +
        '<span class="idc-note">Private: only signed-in players and you can open these. Name files as in the pack (sheriff.jpg, badge-oregon.png, face-01.jpg…).</span></div>' +
      '<div class="idc-grid"><div class="idc-form">' +
        '<div class="idc-kinds">' + [['office', 'Office (evidence packs)'], ['mirror', 'Agency ID'], ['entity', 'Invented company']].map(function (k) { return '<button type="button" class="paper-btn' + (S.kind === k[0] ? ' primary' : '') + '" data-a="kind" data-v="' + k[0] + '">' + k[1] + '</button>'; }).join('') + '</div>' +
        form +
        '<div class="idc-l">Photo<span class="idc-faces">' + faces().map(function (k) { return '<button type="button" class="idc-face' + (S.photo === S.stock[k] ? ' on' : '') + '" data-a="face" data-v="' + esc(k) + '" style="background-image:url(&quot;' + esc(S.stock[k]) + '&quot;)" aria-label="' + esc(k) + '"></button>'; }).join('') +
          '<label class="paper-btn">⇪ Upload<input type="file" accept="image/*" data-a="photo" hidden></label></span></div>' +
        '<div class="idc-file"><b>File it as Evidence</b>' +
          '<label class="idc-l">Title<input data-k="title" value="' + esc(S.title) + '" placeholder="' + esc((nameOf() || 'NPC') + '’s ID') + '"></label>' +
          '<label class="idc-l">Cell<select data-k="cell">' + cellOpts + '</select></label>' +
          '<label class="idc-l">Operation<select data-k="op">' + opOpts + '</select></label>' +
          '<div class="idc-acts"><button type="button" class="paper-btn primary" data-a="file"' + (S.busy || !S.cell ? ' disabled' : '') + '>File as Evidence</button><button type="button" class="paper-btn" data-a="random">⚄ Random look</button><button type="button" class="paper-btn" data-a="print">⎙ Print</button></div>' +
          '<div class="idc-msg">' + esc(S.busy || S.msg) + '</div>' +
          '<div class="idc-note">Filed unreleased, as a picture: release it, tag it or share it from the Evidence tab.</div></div>' +
      '</div><div class="idc-prev" data-idc-prev></div></div>';
    preview();
  }
  function css() {
    if (document.getElementById('idc-css')) return;
    var st = document.createElement('style');
    st.id = 'idc-css';
    st.textContent = '#idc-root{padding:4px 2px}.idc-stock{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 12px;border:1px dashed var(--rule,#b9a77a);margin-bottom:14px;font-size:13px}' +
      '.idc-note{font-size:11.5px;color:#6a5a3a;flex-basis:100%}.idc-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:22px;align-items:start}' +
      '@media(max-width:760px){.idc-grid{grid-template-columns:1fr}.idc-prev{order:-1}}' +
      '#idc-root{color:#2a2112}#idc-root b{color:#1c1608}.idc-kinds{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.idc-l{display:flex;flex-direction:column;gap:3px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px;color:#5a4a2c}' +
      '.idc-l input,.idc-l select{font:14px inherit;padding:6px 8px;border:1px solid var(--rule,#b9a77a);background:#fffdf6;text-transform:none;letter-spacing:0}' +
      '.idc-row{display:flex;gap:6px}.idc-row input{flex:1;min-width:0}.idc-faces,.idc-logos{display:flex;flex-wrap:wrap;gap:6px;align-items:center;text-transform:none}' +
      '.idc-face{width:42px;height:54px;background:#999 center 20%/cover;border:2px solid transparent;cursor:pointer}.idc-face.on{border-color:#8b1a1a}' +
      '.idc-logo{width:44px;height:44px;padding:3px;background:#f6f4ec;border:1px solid var(--rule,#b9a77a);cursor:pointer}' +
      '.idc-file{margin-top:12px;padding-top:10px;border-top:1px solid var(--rule,#b9a77a)}.idc-acts{display:flex;flex-wrap:wrap;gap:6px}.idc-msg{min-height:1.2em;font-size:12.5px;margin-top:6px}' +
      '.idc-prev{display:flex;justify-content:center;padding:18px;background:rgba(28,22,8,.06);border:1px solid var(--rule,#b9a77a)}.idc-prev .dgf-fit{box-shadow:0 10px 26px rgba(0,0,0,.4)}';
    document.head.appendChild(st);
  }

  /* ── Filing: the card as a PNG in evidence/, then an Evidence item ── */
  function loadH2C() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = H2C; s.crossOrigin = 'anonymous';
      s.onload = function () { res(window.html2canvas); }; s.onerror = function () { rej(new Error('Could not load the card renderer.')); };
      document.head.appendChild(s);
    });
  }
  function toPng() {
    var c = card(), sz = F.size(c), box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + sz.w + 'px;background:transparent';
    box.innerHTML = cardHtml(false);
    document.body.appendChild(box);
    return loadH2C().then(function (h2c) {
      return h2c(box.firstChild, { scale: 3, useCORS: true, backgroundColor: null, logging: false });
    }).then(function (cv) {
      box.remove();
      return new Promise(function (res, rej) { cv.toBlob(function (b) { if (b) res(b); else rej(new Error('Could not draw the card.')); }, 'image/png'); });
    }, function (e) { box.remove(); throw e; });
  }
  function file() {
    if (!S.cell) return;
    var id = 'evidence_' + Date.now() + '_' + Math.floor(Math.random() * 100000).toString(36);
    var title = S.title || ((nameOf() || 'NPC') + '’s ID');
    S.busy = 'Filing…'; S.msg = ''; render();
    toPng().then(function (blob) {
      return api().handler().then(function (fb) { return fb.storage().ref('evidence/' + id + '.png').put(blob, { contentType: 'image/png' }); });
    }).then(function (snap) { return snap.ref.getDownloadURL(); }).then(function (url) {
      return api().post({ action: 'create_evidence', evidence_id: id, title: title, body: '', photo: url, cell_id: S.cell, operation_id: S.op || '', released: false, restricted_to: '[]' });
    }).then(function () {
      S.busy = ''; S.msg = 'Filed to the Evidence tab (unreleased): “' + title + '”.';
      S.title = '';
      render();
      try { window.dispatchEvent(new CustomEvent('dg-evidence-changed')); } catch (e) { /* old browser */ }
    }, function (e) { S.busy = ''; S.msg = 'Could not file it: ' + ((e && e.message) || e); render(); });
  }

  /* ── Events ── */
  function wire() {
    root.addEventListener('input', function (e) {
      var t = e.target, k;
      if ((k = t.getAttribute('data-f'))) { S.fields[k] = t.value; preview(); }
      else if ((k = t.getAttribute('data-e')) && t.tagName === 'INPUT') { S.entity[k] = t.value; if (k === 'org') { S.entity.logo = F.logoChoices(t.value, S.entity.kind, 0, 0)[0]; } preview(); }
      else if (t.getAttribute('data-k') === 'title') S.title = t.value;
    });
    root.addEventListener('change', function (e) {
      var t = e.target, k = t.getAttribute('data-k'), a = t.getAttribute('data-a');
      if (t.tagName === 'SELECT' && t.getAttribute('data-f')) { S.fields[t.getAttribute('data-f')] = t.value; return preview(); }
      if (t.tagName === 'SELECT' && t.getAttribute('data-e')) { var ek = t.getAttribute('data-e'); S.entity[ek] = t.value; if (ek === 'kind') { var kd = F.kind(t.value); S.entity.title = kd.titles[0]; S.entity.tag = kd.tags[0]; S.entity.mail = F.roll.mail(S.entity.org, S.entity.name, t.value); S.entity.logo = F.logoChoices(S.entity.org, t.value, 0, 0)[0]; } return render(); }
      if (k === 'tpl') { var n = S.fields.name; S.tpl = t.value; resetFields(); S.fields.name = n; return render(); }
      if (k === 'agency') { S.agency = t.value; var a2 = A.byCode(t.value); S.fields.title = a2 ? a2.title : 'Agent'; return render(); }
      if (k === 'era') { S.era = t.value; S.fields.era = t.value; return render(); }
      if (k === 'cell') { S.cell = t.value; S.op = ''; return render(); }
      if (k === 'op') { S.op = t.value; return; }
      if (a === 'upload') { uploadStock(t.files); t.value = ''; return; }
      if (a === 'photo' && t.files && t.files[0]) {
        var r = new FileReader();
        r.onload = function () { S.photo = String(r.result || ''); render(); };
        r.readAsDataURL(t.files[0]); t.value = '';
      }
    });
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b || b.tagName === 'INPUT' || b.disabled) return;
      var a = b.getAttribute('data-a'), v = b.getAttribute('data-v');
      if (a === 'kind') { var n = nameOf(); S.kind = v; resetFields(); if (n) { if (S.kind === 'entity') S.entity.name = n; else S.fields.name = n; } render(); }
      else if (a === 'roll') { S.fields[b.getAttribute('data-k')] = F.roll[b.getAttribute('data-r')](S.fields.name); render(); }
      else if (a === 'roll-org') { S.entity.org = F.roll.company(S.entity.kind); S.entity.mail = F.roll.mail(S.entity.org, S.entity.name, S.entity.kind); S.entity.logo = F.logoChoices(S.entity.org, S.entity.kind, 0, 0)[0]; render(); }
      else if (a === 'logo') { S.entity.logo = F.logoChoices(S.entity.org, S.entity.kind, S.logoBatch || 0, 0)[+b.getAttribute('data-i')]; render(); }
      else if (a === 'logo-more') { S.logoBatch = (S.logoBatch || 0) + 1; render(); }
      else if (a === 'face') { S.photo = S.stock[v]; render(); }
      else if (a === 'random') randomLook();
      else if (a === 'print') F.print(cardHtml(true), F.size(card()));
      else if (a === 'file') file();
    });
  }
  function preview() {
    var p = root.querySelector('[data-idc-prev]');
    if (!p) return;
    // As wide as its own column allows (less its padding).
    var c = card(), sz = F.size(c), w = Math.max(160, Math.min(460, (p.clientWidth || 400) - 38));
    p.innerHTML = F.fit(cardHtml(), sz, Math.min(w, sz.w * 1.5));
  }
  // Opened the first time the tab is shown.
  function open() {
    root = document.getElementById('idc-root');
    if (!root || root._idcOpen) return;
    root._idcOpen = true;
    F = window.dgForge; A = window.dgAgencies;
    css();
    resetFields();
    wire();
    render();
    refreshStock();
    loadLists();
  }
  document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('.tw[data-tab="ids"]'); if (t) setTimeout(open, 0); });
  window.addEventListener('resize', function () { if (root && root._idcOpen) preview(); });
  window.dgAcellIds = { open: open, state: function () { return S; } };
})();
