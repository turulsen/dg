/* A-Cell on a phone, Notes (v3.13.0): the Obsidian vault the way the
   Notebook Navigator and Omnisearch plugins have it -- folders one level
   at a time with a path back up, notes with a preview and their date,
   Recent, Pinned and Tags; and a search that ranks titles over headings
   over text, forgives a typo, and shows the matching line.

   A note opens to read; tap the text and it's editing there and then
   (with a bar over the keyboard); Done goes back to reading. Make NPC
   only shows on a note that is one (in an NPCs folder, tagged #npc, or
   "type: npc" at the top). Pins and recent searches stay on this device. */
(function () {
  'use strict';
  var A = window.dgAc, C = window.dgAcm;
  if (!A || !C || window.dgAcmNotes) return;
  var esc = A.esc, I = C.icon, btn = C.btn, lab = C.lab;
  function V() { return window.dgVault; }
  function S() { return window.dgSessions; }

  var nv = { dir: '', seg: 'folders', sort: 'modified', tag: '', q: '', scope: 'all', field: 'all' };
  function pins() { return A.store('dg_acm_pins', []); }
  function setPins(p) { A.keep('dg_acm_pins', p); }
  function dirOf(p) { return p.indexOf('/') >= 0 ? p.slice(0, p.lastIndexOf('/')) : ''; }
  function title(p) { return V().title(p); }
  function when(t) {
    if (!t) return '';
    var d = new Date(t && t.toMillis ? t.toMillis() : t), days = Math.floor((Date.now() - d.getTime()) / 864e5);
    return days < 1 ? 'today' : days < 2 ? 'yesterday' : days < 7 ? days + 'd' : d.toISOString().slice(0, 10);
  }
  function updated(n) { var u = n.updated_at; return u && u.toMillis ? u.toMillis() : +u || 0; }
  function preview(md) {
    var lines = String(md || '').replace(/^---\n[\s\S]*?\n---\n?/, '').split('\n');
    var l = lines.filter(function (x) { return x.trim() && !/^#{1,6}\s/.test(x) && !/^---/.test(x); })[0] || '';
    return C.plain(l.replace(/^\s*[-*]\s+(\[[ xX]\]\s*)?/, '')).slice(0, 110);
  }
  function tagsOf(md) {
    var out = {}, body = String(md || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    body.replace(/(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu, function (x, a, t) { out[t.toLowerCase()] = true; return x; });
    var fm = /^---\n([\s\S]*?)\n---/.exec(md || '');
    if (fm) { var m = /^tags:\s*\[?([^\]\n]*)\]?/m.exec(fm[1]); if (m) m[1].split(/[,\s]+/).forEach(function (t) { t = t.replace(/^#/, '').trim(); if (t) out[t.toLowerCase()] = true; }); }
    return Object.keys(out);
  }
  function isNpc(n) {
    if (!n) return false;
    return /(^|\/)NPCs\//i.test(n.path) || tagsOf(n.content).indexOf('npc') >= 0 || /^---\n[\s\S]*?\btype:\s*npc\b[\s\S]*?\n---/i.test(n.content || '');
  }
  function noteRow(n) {
    var p = pins().indexOf(n.path) >= 0;
    return '<button type="button" class="acm-nrow" data-acm="vopen" data-path="' + esc(n.path) + '"><span class="acm-g"><b>' + (p ? I('pin', 's') + ' ' : '') + esc(title(n.path)) + '</b><small>' + esc(preview(n.content) || ' ') + '</small></span><em>' + esc(when(updated(n))) + '</em></button>';
  }
  function sortNotes(list) {
    return list.slice().sort(nv.sort === 'name' ? function (a, b) { return V().byName(title(a.path), title(b.path)); } : function (a, b) { return updated(b) - updated(a); });
  }

  /* ── The navigator ── */
  C.screen('vault', {
    mode: 'prep', tab: '@more',
    render: function () {
      var all = V() ? V().notes() : [];
      var body = '';
      if (nv.seg === 'folders') {
        var pre = nv.dir ? nv.dir + '/' : '', subs = {}, here = [];
        all.forEach(function (n) {
          if (pre && n.path.indexOf(pre) !== 0) return;
          var rest = n.path.slice(pre.length), i = rest.indexOf('/');
          if (i >= 0) { var d = rest.slice(0, i); subs[d] = (subs[d] || 0) + 1; } else here.push(n);
        });
        var crumbs = nv.dir ? nv.dir.split('/') : [];
        body = '<div class="acm-crumb"><button type="button" data-acm="vdir" data-d="">Vault</button>' + crumbs.map(function (c, i) { return ' / <button type="button" data-acm="vdir" data-d="' + esc(crumbs.slice(0, i + 1).join('/')) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
          (Object.keys(subs).length ? '<div class="acm-card">' + Object.keys(subs).sort(V().byName).map(function (d) {
            return '<button type="button" class="acm-row" data-acm="vdir" data-d="' + esc(pre + d) + '">' + I('session') + '<span class="acm-g"><b>' + esc(V().folderLabel(d) || d) + '</b></span><span class="acm-note">' + subs[d] + '</span>' + I('chev', 's') + '</button>';
          }).join('') + '</div>' : '') +
          (here.length ? '<div class="acm-nsort"><span class="acm-lab">' + here.length + ' note' + (here.length === 1 ? '' : 's') + '</span><button type="button" class="acm-chip" data-acm="vsort">' + (nv.sort === 'name' ? 'A–Z' : 'Newest') + '</button></div><div class="acm-card">' + sortNotes(here).map(noteRow).join('') + '</div>' : (Object.keys(subs).length ? '' : '<p class="acm-none">Nothing in this folder.</p>'));
      } else if (nv.seg === 'recent') {
        body = '<div class="acm-card">' + all.slice().sort(function (a, b) { return updated(b) - updated(a); }).slice(0, 30).map(noteRow).join('') + '</div>';
      } else if (nv.seg === 'pinned') {
        var ps = pins().map(function (p) { return V().get(p); }).filter(Boolean);
        body = ps.length ? '<div class="acm-card">' + ps.map(noteRow).join('') + '</div>' : '<p class="acm-none">Nothing pinned yet. Pin a note from its menu.</p>';
      } else {
        var counts = {};
        all.forEach(function (n) { tagsOf(n.content).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
        if (nv.tag) body = '<div class="acm-crumb"><button type="button" data-acm="vtag" data-t="">Tags</button> / #' + esc(nv.tag) + '</div><div class="acm-card">' + sortNotes(all.filter(function (n) { return tagsOf(n.content).indexOf(nv.tag) >= 0; })).map(noteRow).join('') + '</div>';
        else body = Object.keys(counts).length ? '<div class="acm-chips">' + Object.keys(counts).sort().map(function (t) { return '<button type="button" class="acm-chip" data-acm="vtag" data-t="' + esc(t) + '">#' + esc(t) + ' <small>' + counts[t] + '</small></button>'; }).join('') + '</div>' : '<p class="acm-none">No #tags in the vault yet.</p>';
      }
      return {
        bar: { title: 'Notes', sub: 'Obsidian vault · ' + all.length + ' notes', back: false, right: [['settings', 'vsync', 'Vault sync']] },
        html: '<div class="acm-fold"><button type="button" class="acm-searchbox" data-acm="go:vsearch">' + I('search') + '<span>Search the whole vault</span></button>' +
          '<div class="acm-seg">' + [['folders', 'Folders'], ['recent', 'Recent'], ['pinned', 'Pinned ' + pins().length], ['tags', 'Tags']].map(function (x) { return '<button type="button" class="' + (nv.seg === x[0] ? 'on' : '') + '" data-acm="vseg" data-s="' + x[0] + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>' +
          body + btn(I('add') + 'New note' + (nv.seg === 'folders' && nv.dir ? ' here' : ''), 'vnew', 'k w') + '</div>'
      };
    }
  });

  /* ── Search: Omnisearch-style ── */
  var idx = { at: 0, docs: [] };
  function words(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}#]+/u).filter(Boolean); }
  function index() {
    var notes = V().notes(), sig = notes.length + ':' + notes.reduce(function (s, n) { return s + updated(n); }, 0);
    if (idx.sig === sig) return idx.docs;
    idx.sig = sig;
    idx.docs = notes.map(function (n) {
      var md = n.content || '';
      return { n: n, t: words(title(n.path)), h: words((md.match(/^#{1,6}\s.+$/gm) || []).join(' ')), b: words(md), tags: tagsOf(md) };
    });
    return idx.docs;
  }
  function near(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
    var i = 0, j = 0, e = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++e > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return e + (a.length - i) + (b.length - j) <= 1;
  }
  function hit(term, list) {
    var best = 0;
    for (var k = 0; k < list.length; k++) {
      var w = list[k];
      if (w === term) return 3;
      if (w.indexOf(term) === 0) best = Math.max(best, 2);
      else if (term.length > 3 && near(term, w.slice(0, term.length + 1)) || near(term, w)) best = Math.max(best, 1);
    }
    return best;
  }
  function search(q) {
    var terms = words(q).map(function (t) { return t.replace(/^#/, ''); }).filter(Boolean), tagOnly = /^#/.test(q.trim());
    if (!terms.length) return [];
    var pre = nv.scope === 'here' && nv.dir ? nv.dir + '/' : '';
    return index().map(function (d) {
      if (pre && d.n.path.indexOf(pre) !== 0) return null;
      var score = 0, all = true;
      terms.forEach(function (t) {
        var s = 0;
        if (nv.field === 'all' || nv.field === 'tags' || tagOnly) s += d.tags.some(function (x) { return x === t || x.indexOf(t) === 0; }) ? 7 : 0;
        if (!tagOnly) {
          if (nv.field === 'all' || nv.field === 'titles') s += hit(t, d.t) * 6;
          if (nv.field === 'all' || nv.field === 'text') { s += hit(t, d.h) * 2.5; var bh = hit(t, d.b); s += bh; }
        }
        if (!s) all = false;
        score += s;
      });
      return all && score ? { n: d.n, score: score + updated(d.n) / 1e13 } : null;
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 40);
  }
  function excerpt(md, q) {
    var terms = words(q).map(function (t) { return t.replace(/^#/, ''); }).filter(function (t) { return t.length > 1; });
    var lines = String(md || '').split('\n'), line = '';
    for (var i = 0; i < lines.length && !line; i++) { var lw = lines[i].toLowerCase(); if (terms.some(function (t) { return lw.indexOf(t) >= 0; })) line = lines[i]; }
    line = C.plain(line || preview(md)).replace(/^#+\s*/, '');
    var html = esc(line.length > 140 ? line.slice(0, 140) + '…' : line);
    terms.forEach(function (t) { html = html.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>'); });
    return html;
  }
  C.screen('vsearch', {
    mode: 'prep', tab: '@more',
    render: function () {
      var recent = A.store('dg_acm_vq', []);
      return {
        keep: true,
        bar: { title: 'Search', sub: 'Titles, headings, text, #tags', back: true },
        html: '<div class="acm-fold"><input type="search" class="acm-in acm-vq" placeholder="Search the vault (#tag for tags)" value="' + esc(nv.q) + '" autocomplete="off">' +
          '<div class="acm-chips acm-vf">' + [['scope', 'all', 'Everywhere'], ['scope', 'here', nv.dir ? 'In ' + nv.dir.split('/').pop() : 'This folder'], ['field', 'all', 'Everything'], ['field', 'titles', 'Titles'], ['field', 'text', 'Text'], ['field', 'tags', '#tags']].map(function (x) {
            return '<button type="button" class="acm-chip' + (nv[x[0]] === x[1] ? ' on' : '') + '" data-k="' + x[0] + '" data-v="' + x[1] + '">' + esc(x[2]) + '</button>';
          }).join('') + '</div><div class="acm-vres"></div>' +
          (recent.length ? '<div class="acm-vrecent">' + lab('Recent searches') + '<div class="acm-chips">' + recent.map(function (r) { return '<button type="button" class="acm-chip" data-rq="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div></div>' : '') + '</div>',
        after: function (el) {
          var inp = el.querySelector('.acm-vq'), res = el.querySelector('.acm-vres'), t = null;
          function draw() {
            nv.q = inp.value;
            var r = nv.q.trim() ? search(nv.q) : [];
            res.innerHTML = nv.q.trim() ? (r.length ? '<div class="acm-note">' + r.length + ' result' + (r.length === 1 ? '' : 's') + ' · best match first</div><div class="acm-card">' + r.map(function (x) {
              return '<button type="button" class="acm-nrow" data-acm="vopen" data-path="' + esc(x.n.path) + '" data-q="1"><span class="acm-g"><b>' + esc(title(x.n.path)) + '</b><small>' + esc(V().folderLabel(dirOf(x.n.path)) || 'vault') + '</small><span class="acm-ex">' + excerpt(x.n.content, nv.q) + '</span></span></button>';
            }).join('') + '</div>' : '<p class="acm-none">Nothing matches.</p>') : '';
            var rc = el.querySelector('.acm-vrecent'); if (rc) rc.hidden = !!nv.q.trim();
          }
          inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(draw, 120); });
          el.addEventListener('click', function (e) {
            var c = e.target.closest('[data-k]');
            if (c) { nv[c.getAttribute('data-k')] = c.getAttribute('data-v'); Array.prototype.forEach.call(el.querySelectorAll('[data-k="' + c.getAttribute('data-k') + '"]'), function (x) { x.classList.toggle('on', x === c); }); draw(); return; }
            var rq = e.target.closest('[data-rq]');
            if (rq) { inp.value = rq.getAttribute('data-rq'); draw(); return; }
            if (e.target.closest('[data-q]') && nv.q.trim()) {
              var r2 = A.store('dg_acm_vq', []).filter(function (x) { return x !== nv.q.trim(); });
              r2.unshift(nv.q.trim()); A.keep('dg_acm_vq', r2.slice(0, 8));
            }
          });
          draw();
          setTimeout(function () { inp.focus(); }, 80);
        }
      };
    }
  });

  /* ── A note: read; tap to write ── */
  var nt = { edit: false, line: 0 };
  C.screen('vnote', {
    mode: 'prep', tab: '@more',
    render: function (path) {
      var n = path && V().get(path);
      if (!n) return { bar: { title: 'Note', back: true }, html: '<div class="acm-fold"><p class="acm-none">' + (V() && V().notes().length ? 'That note is gone.' : 'Loading the vault…') + '</p></div>' };
      return {
        writing: nt.edit,
        bar: { title: title(path), sub: V().folderLabel(dirOf(path)) || 'vault', back: true, right: [nt.edit ? ['check', 'vdone', 'Done'] : ['more', 'vmenu', 'Note actions']] },
        html: '<div class="acm-fold acm-vnote' + (nt.edit ? ' editing' : '') + '"><div class="acm-ed acm-paperpage" data-path="' + esc(path) + '"></div>' +
          (!nt.edit && isNpc(n) ? '<div class="acm-g2">' + btn(I('npc') + 'Make NPC', 'vmake-npc', '', 'data-path="' + esc(path) + '"') + (A.session() ? btn('Add to ' + esc(A.session().name.split(/\s+[—-]\s+/)[0]), 'vadd-npc', '', 'data-path="' + esc(path) + '"') : '') + '</div>' : '') + '</div>' +
          (nt.edit ? '<div class="acm-ktool"><button type="button" data-kt="b">B</button><button type="button" data-kt="i"><i>I</i></button><button type="button" data-kt="h">H</button><button type="button" data-kt="li">List</button><button type="button" data-kt="link">[[ ]]</button><button type="button" data-kt="tag">#tag</button><button type="button" data-kt="done">Done</button></div>' : ''),
        after: function (el) {
          var host = el.querySelector('.acm-ed');
          var ed = V().editor(host, path, { hideHead: true, mode: nt.edit ? 'edit' : 'read', grow: true, onLink: function (p) { C.go('vnote', p); } });
          if (nt.edit) {
            var ta = host.querySelector('.vn-ta');
            if (ta) {
              var at = 0, ls = ta.value.split('\n');
              for (var i = 0; i < Math.min(nt.line, ls.length); i++) at += ls[i].length + 1;
              setTimeout(function () { ta.focus(); try { ta.setSelectionRange(at, at); } catch (e) { /* old */ } }, 60);
            }
            var tool = el.querySelector('.acm-ktool');
            tool.addEventListener('pointerdown', function (e) { if (e.target.closest('[data-kt]')) e.preventDefault(); });
            tool.addEventListener('click', function (e) {
              var b = e.target.closest('[data-kt]'), x = host.querySelector('.vn-ta');
              if (!b || !x) return;
              var k = b.getAttribute('data-kt');
              if (k === 'done') { nt.edit = false; C.go('vnote', path, { replace: true }); return; }
              var a0 = x.selectionStart, b0 = x.selectionEnd, sel = x.value.slice(a0, b0), ins, caret;
              if (k === 'b' || k === 'i') { var m = k === 'b' ? '**' : '*'; ins = m + (sel || '') + m; caret = sel ? ins.length : m.length; }
              else if (k === 'link') { ins = '[[' + sel + ']]'; caret = sel ? ins.length : 2; }
              else if (k === 'tag') { ins = '#' + sel; caret = ins.length; }
              else {
                var ls0 = x.value.lastIndexOf('\n', a0 - 1) + 1;
                x.setSelectionRange(ls0, ls0); a0 = b0 = ls0; ins = k === 'h' ? '## ' : '- '; caret = ins.length;
              }
              x.value = x.value.slice(0, a0) + ins + x.value.slice(b0);
              x.selectionStart = x.selectionEnd = a0 + caret;
              x.focus();
              x.dispatchEvent(new Event('input', { bubbles: true }));
            });
            var place = function () { var vv = window.visualViewport; if (vv) tool.style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px'; };
            if (window.visualViewport) { window.visualViewport.addEventListener('resize', place); window.visualViewport.addEventListener('scroll', place); }
            place();
            return function () { ed.destroy(); if (window.visualViewport) { window.visualViewport.removeEventListener('resize', place); window.visualViewport.removeEventListener('scroll', place); } };
          }
          // Reading: a tap on the text (not a link, tick box or cue) starts writing at that line.
          host.addEventListener('click', function (e) {
            if (e.target.closest('a, [data-vlink], .vn-ck, [data-cue], button, input')) return;
            var body = host.querySelector('.vn-body');
            if (!body) return;
            var r = body.getBoundingClientRect(), total = (V().get(path).content || '').split('\n').length;
            nt.line = Math.max(0, Math.min(total - 1, Math.round((e.clientY - r.top) / Math.max(1, r.height) * total)));
            nt.edit = true;
            C.go('vnote', path, { replace: true });
          });
          return function () { ed.destroy(); };
        }
      };
    }
  });

  var X = C.actions;
  X.vseg = function (b) { nv.seg = b.getAttribute('data-s'); nv.tag = ''; C.refresh(); };
  X.vdir = function (b) { nv.dir = b.getAttribute('data-d'); nv.seg = 'folders'; C.refresh(); };
  X.vtag = function (b) { nv.tag = b.getAttribute('data-t'); C.refresh(); };
  X.vsort = function () { nv.sort = nv.sort === 'name' ? 'modified' : 'name'; C.refresh(); };
  X.vopen = function (b) { nt.edit = false; C.go('vnote', b.getAttribute('data-path')); };
  X.vsync = function () { V().settings(); };
  X.vnew = function () { V().picker({ title: 'New note', newPath: nv.seg === 'folders' && nv.dir ? nv.dir + '/' : '', onPick: function (p) { nt.edit = true; nt.line = 9999; C.go('vnote', p); } }); };
  X.vdone = function () { nt.edit = false; C.refresh(); var p = document.querySelector('.acm-vnote .acm-ed'); C.go('vnote', p ? p.getAttribute('data-path') : '', { replace: true }); };
  X.vmenu = function () {
    var host = document.querySelector('.acm-vnote .acm-ed'), path = host && host.getAttribute('data-path');
    if (!path) return;
    var s = A.session(), pinned = pins().indexOf(path) >= 0, n = V().get(path);
    var w = C.sheet('<h2 class="acm-h">' + esc(title(path)) + '</h2>' + [
      ['edit', 'Edit', 'or tap the text', 'edit'], ['pin', pinned ? 'Unpin' : 'Pin', 'keep it under Pinned', 'pin'],
      s ? ['use', s.note_path === path ? 'These are the notes for ' + s.name : 'Use as the notes for ' + s.name, '', 'session'] : null,
      isNpc(n) ? ['npc', 'Make NPC', 'DEX, HP, WP, SAN at the top', 'npc'] : null,
      ['folder', 'Show its folder', V().folderLabel(dirOf(path)) || 'vault', 'vault'], ['del', 'Delete note', 'from the vault (and Obsidian, on the next sync)', 'trash']
    ].filter(Boolean).map(function (r) { return '<button type="button" class="acm-mrow' + (r[0] === 'del' ? ' red' : '') + '" data-vm="' + r[0] + '">' + I(r[3]) + '<span><b>' + esc(r[1]) + '</b><small>' + esc(r[2]) + '</small></span></button>'; }).join(''));
    w.addEventListener('click', function (e) {
      var b = e.target.closest('[data-vm]');
      if (!b) return;
      var a = b.getAttribute('data-vm');
      w.close();
      if (a === 'edit') { nt.edit = true; nt.line = 0; C.go('vnote', path, { replace: true }); }
      else if (a === 'pin') { var p = pins().filter(function (x) { return x !== path; }); if (!pinned) p.unshift(path); setPins(p); C.toast(pinned ? 'Unpinned.' : 'Pinned.'); }
      else if (a === 'use' && s) S().update(s.id, { note_path: path, html_note: null }).then(function () { C.toast('Now the notes for ' + s.name + '.'); });
      else if (a === 'npc') makeNpc(path);
      else if (a === 'folder') { nv.dir = dirOf(path); nv.seg = 'folders'; C.go('vault'); }
      else if (a === 'del') A.ask('Delete “' + title(path) + '” from the vault?', 'Delete', 'Keep it').then(function (y) { if (y) { V().remove(path); C.back(); } });
    });
  };
  // Make NPC: the note gets an npc header (DEX/HP/WP/SAN) if it hasn't one, then the numbers sheet.
  function makeNpc(path) {
    var n = V().get(path), p = C.parseNpc(n && n.content);
    var npc = p && p.name ? p : { name: title(path), dex: 10, hp: 10, wp: 10, san: 0 };
    npc.path = path;
    var md = n.content || '';
    var save = p ? Promise.resolve() : V().save(path, '---\ntype: npc\ndex: ' + npc.dex + '\nhp: ' + npc.hp + '\nwp: ' + npc.wp + '\nsan: ' + npc.san + '\n---\n' + md.replace(/^---\n[\s\S]*?\n---\n?/, ''));
    save.then(function () { C.toast(npc.name + ' is an NPC: add them to a session from here or from Session prep.'); C.refresh(); });
  }
  X['vmake-npc'] = function (b) { makeNpc(b.getAttribute('data-path')); };
  X['vadd-npc'] = function (b) {
    var path = b.getAttribute('data-path'), s = A.session(), p = C.parseNpc((V().get(path) || {}).content);
    if (!s) return;
    var npc = p && p.name ? p : { name: title(path), dex: 10 };
    npc.path = path; npc.init = false;
    if (s.npcs.some(function (x) { return x.path === path; })) { C.toast('Already in ' + s.name + '.'); return; }
    S().update(s.id, { npcs: s.npcs.concat([npc]) }).then(function () { C.toast(npc.name + ' is in ' + s.name + ' (Upcoming).'); });
  };

  // A link to a note from anywhere (Agents, the desk, the notebook) opens it here.
  document.addEventListener('dg-acell-open-note', function (e) { if (C.on()) { nt.edit = false; C.go('vnote', e.detail.path); } });
  window.dgAcmNotes = { open: function (p) { nt.edit = false; C.go('vnote', p); } };
})();
