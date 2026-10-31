/* A-Cell's notes vault (v3.12.0): the Handler's Obsidian vault, kept in
   Firestore vault/ (Handler-only) and in step with the iCloud folder by
   an Apple Shortcut that posts to the vaultSync Cloud Function
   (functions/vault-sync.js has the rules of who wins).

   A note: vault/{id} = { path, content, synced, pending, updated_at,
   updated_by }. id = the path, base64url (Firestore ids can't hold "/").
   A-Cell only ever writes path/content/updated_*; synced and pending are
   the sync's own bookkeeping.

   window.dgVault = {
     load() -> Promise of notes [{ path, content, … }]   (cached, live)
     notes(), get(path), save(path, content), remove(path), id(path),
     render(md, opts) -> HTML, headings(md), section(md, title),
     toggleTask(md, line), editor(host, path, opts), picker(opts),
     settings()
   }
   Fires 'dg-vault' on document whenever the notes change. */
(function () {
  'use strict';
  if (window.dgVault) return;

  var SYNC_URL = 'https://us-central1-dg-app-b3447.cloudfunctions.net/vaultSync';
  var notesByPath = {};
  var loading = null, unlisten = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fb() { return window.dgAcellApi.handler(); }
  function col(f) { return f.firestore().collection('vault'); }
  function id(path) {
    var b = btoa(unescape(encodeURIComponent(path)));
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function cleanPath(p) {
    p = String(p || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
    if (!p || /(^|\/)\.\.?(\/|$)/.test(p)) return '';
    if (!/\.md$/i.test(p)) p += '.md';
    return p;
  }
  /* ── Names for people: a note's title and its folder, readable ──
     A path from before the sync understood iOS paths can still be
     "iCloudDrive:Obsidian:Vault:Folder:Note.txt.md": read either way. */
  function segs(path) {
    var p = String(path || '');
    var parts = (p.indexOf('/') < 0 && p.indexOf(':') >= 0) ? p.split(':') : p.split('/');
    if (/^icloud ?drive$/i.test(parts[0] || '') && /^obsidian$/i.test(parts[1] || '')) parts = parts.slice(3);
    return parts.filter(Boolean);
  }
  function tidy(seg) {
    var t = String(seg || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    var bare = t.replace(/^\d+[\s.\-]*(?=\D)/, '');
    return bare || t;
  }
  function title(path) {
    var last = segs(path).pop() || '';
    return last.replace(/(\.txt)?\.md$/i, '').replace(/\.txt$/i, '').replace(/_/g, ' ').trim() || last;
  }
  function dirOf(path) { return segs(path).slice(0, -1).join('/'); }
  function byName(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }); }
  // The vault's own top folder, when every note sits inside it -- not repeated on every row.
  function rootDir() {
    var first = null, all = true;
    Object.keys(notesByPath).forEach(function (p) {
      var sg = segs(p);
      var f = sg.length > 1 ? sg[0] : '';
      if (first === null) first = f; else if (f !== first) all = false;
    });
    return all && first ? first : '';
  }
  function folderLabel(dir) {
    var sg = String(dir || '').split('/').filter(Boolean), root = rootDir();
    if (root && sg[0] === root) sg = sg.slice(1);
    return sg.map(tidy).join(' › ');
  }
  function emit() { document.dispatchEvent(new CustomEvent('dg-vault')); }
  function put(d) {
    if (!d || !d.path) return;
    notesByPath[d.path] = { path: d.path, content: d.content || '', updated_at: d.updated_at || 0, synced: d.synced, pending: d.pending };
  }

  function load() {
    if (loading) return loading;
    loading = fb().then(function (f) {
      return col(f).get().then(function (snap) {
        snap.forEach(function (doc) { put(doc.data()); });
        emit();
        try {
          unlisten = col(f).onSnapshot(function (s) {
            var fresh = {};
            s.forEach(function (doc) { var d = doc.data(); if (d && d.path) fresh[d.path] = true; put(d); });
            Object.keys(notesByPath).forEach(function (p) { if (!fresh[p] && !notesByPath[p].local) delete notesByPath[p]; });
            emit();
          }, function () { /* keep what was read */ });
        } catch (e) { /* no live updates: the read above stands */ }
        return notes();
      });
    }).catch(function (err) { loading = null; throw err; });
    return loading;
  }
  function notes() {
    return Object.keys(notesByPath).sort(function (a, b) { return a.localeCompare(b); }).map(function (p) { return notesByPath[p]; });
  }
  function get(path) { return notesByPath[path] || null; }
  function save(path, content) {
    path = cleanPath(path);
    if (!path) return Promise.reject(new Error('A note needs a name.'));
    var now = Date.now();
    notesByPath[path] = Object.assign({}, notesByPath[path] || { synced: null, pending: null }, { path: path, content: content, updated_at: now, local: true });
    emit();
    return fb().then(function (f) {
      return col(f).doc(id(path)).set({ path: path, content: content, updated_at: now, updated_by: 'acell' }, { merge: true });
    }).then(function () { return path; });
  }
  function remove(path) {
    delete notesByPath[path];
    emit();
    return fb().then(function (f) { return col(f).doc(id(path)).delete(); });
  }

  /* ── Markdown, the Obsidian flavour the vault uses ── */
  var CUE = /^(♪|⚡|◫|☠)\s*/;
  function inline(s, opts) {
    var out = esc(s);
    var codes = [];
    out = out.replace(/`([^`]+)`/g, function (m, c) {
      codes.push(c);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    // A few plain HTML tags, as Obsidian shows them (no attributes).
    out = out.replace(/&lt;(\/?)(b|i|u|s|em|strong|mark|sub|sup)&gt;/gi, '<$1$2>').replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    out = out
      .replace(/!\[\[([^\]]+)\]\]/g, function (m, t) { return '<span class="vn-embed">⧉ ' + t + '</span>'; })
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function (m, t, alias) {
        return '<a class="vn-link" data-vlink="' + t.replace(/"/g, '&quot;') + '">' + (alias || t.split('#')[0].split('/').pop()) + '</a>';
      })
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/__([^_]+)__/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/==([^=]+)==/g, '<mark>$1</mark>')
      .replace(/(^|\s)#([A-Za-zÀ-ɏ][\wÀ-ɏ/-]*)/g, '$1<span class="vn-tag">#$2</span>');
    out = out.replace(/\u0000(\d+)\u0000/g, function (m, i) {
      var c = codes[+i];
      var cue = CUE.exec(c);
      if (cue) return '<span class="vn-cue" data-cue="' + c.replace(/"/g, '&quot;') + '">' + c + '</span>';
      return '<code>' + c + '</code>';
    });
    return out;
  }
  // Render: opts.tasks (ticks are clickable: data-vline is the line number)
  function render(md, opts) {
    opts = opts || {};
    var lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    var html = [], i = 0, list = null;
    // Numbered lists count (2026-10-31: read mode showed 1, 1, 1): within a
    // list each item is the one before plus one, whatever was written
    // ("1. 1. 1." is 1, 2, 3); a blank line between items doesn't end the
    // list; steps parted by text, where the next starts again at 1, carry
    // on from the last in the same section (a heading starts over); any
    // other first number is kept as written.
    var olN = 0, olLast = 0;
    function closeList() { if (list) { html.push('</' + list + '>'); if (list === 'ol') olLast = olN; list = null; } }
    function nextIsItem(from, kind) {
      for (var k = from; k < lines.length; k++) {
        if (!lines[k].trim()) continue;
        return kind === 'ol' ? /^\s*\d+[.)]\s+/.test(lines[k]) : /^\s*[-*+]\s+/.test(lines[k]);
      }
      return false;
    }
    if (lines[0] === '---') {
      var end = lines.indexOf('---', 1);
      if (end > 0) {
        html.push('<div class="vn-front">' + lines.slice(1, end).map(esc).join('<br>') + '</div>');
        i = end + 1;
      }
    }
    for (; i < lines.length; i++) {
      var l = lines[i], m;
      if (/^```/.test(l)) {
        closeList();
        var buf = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(esc(lines[i]));
        html.push('<pre class="vn-pre">' + buf.join('\n') + '</pre>');
        continue;
      }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
        closeList(); olLast = 0;
        html.push('<h' + m[1].length + ' class="vn-h" data-vline="' + i + '">' + inline(m[2], opts) + '</h' + m[1].length + '>');
        continue;
      }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(l)) { closeList(); html.push('<hr class="vn-hr">'); continue; }
      if ((m = /^>\s*\[!(\w+)\][+-]?\s*(.*)$/.exec(l))) {
        closeList();
        var body = [];
        for (i++; i < lines.length && /^>/.test(lines[i]); i++) body.push(inline(lines[i].replace(/^>\s?/, ''), opts));
        i--;
        var kind = m[1].toLowerCase();
        html.push('<div class="vn-call vn-call-' + esc(kind) + '"><div class="vn-call-t">' + (inline(m[2], opts) || esc(kind.toUpperCase())) + '</div>' + (body.length ? '<div>' + body.join('<br>') + '</div>' : '') + '</div>');
        continue;
      }
      if (/^>/.test(l)) {
        closeList();
        var q = [];
        for (; i < lines.length && /^>/.test(lines[i]); i++) q.push(inline(lines[i].replace(/^>\s?/, ''), opts));
        i--;
        html.push('<blockquote class="vn-quote">' + q.join('<br>') + '</blockquote>');
        continue;
      }
      if (/^\|/.test(l)) {
        closeList();
        var rows = [];
        for (; i < lines.length && /^\|/.test(lines[i]); i++) {
          if (/^\|[\s:-]+\|[\s:|-]*$/.test(lines[i])) continue;
          rows.push(lines[i].replace(/^\||\|$/g, '').split('|').map(function (c) { return inline(c.trim(), opts); }));
        }
        i--;
        html.push('<table class="vn-table">' + rows.map(function (r, ri) {
          return '<tr>' + r.map(function (c) { return ri === 0 ? '<th>' + c + '</th>' : '<td>' + c + '</td>'; }).join('') + '</tr>';
        }).join('') + '</table>');
        continue;
      }
      if ((m = /^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(l))) {
        if (list !== 'ul') { closeList(); html.push('<ul class="vn-list vn-tasks">'); list = 'ul'; }
        var done = m[2] !== ' ';
        html.push('<li class="vn-task' + (done ? ' done' : '') + '" style="margin-left:' + (m[1].length * 8) + 'px"><span class="vn-ck' + (done ? ' on' : '') + '" data-vline="' + i + '" role="checkbox" aria-checked="' + done + '"></span><span>' + inline(m[3], opts) + '</span></li>');
        continue;
      }
      if ((m = /^(\s*)[-*+]\s+(.*)$/.exec(l))) {
        if (list !== 'ul') { closeList(); html.push('<ul class="vn-list">'); list = 'ul'; }
        html.push('<li style="margin-left:' + (m[1].length * 8) + 'px">' + inline(m[2], opts) + '</li>');
        continue;
      }
      // A numbered item keeps the number written (2026-10-31: a list broken
      // by a blank line or a paragraph started again at 1 every time).
      if ((m = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(l))) {
        if (list !== 'ol') { closeList(); html.push('<ol class="vn-list">'); list = 'ol'; olN = +m[2] === 1 && olLast ? olLast + 1 : +m[2]; }
        else olN++;
        html.push('<li value="' + olN + '" style="margin-left:' + (m[1].length * 8) + 'px">' + inline(m[3], opts) + '</li>');
        continue;
      }
      if (!l.trim() && list && nextIsItem(i + 1, list)) continue;
      closeList();
      if (!l.trim()) { html.push('<div class="vn-gap"></div>'); continue; }
      html.push('<p class="vn-p">' + inline(l, opts) + '</p>');
    }
    closeList();
    return html.join('');
  }
  function toggleTask(md, line) {
    var lines = String(md || '').split('\n');
    var l = lines[line];
    if (l == null) return md;
    lines[line] = /\[( )\]/.test(l) ? l.replace('[ ]', '[x]') : l.replace(/\[(x|X)\]/, '[ ]');
    return lines.join('\n');
  }
  // ## headings (the scenes): [{ title, line }]
  function headings(md, level) {
    var re = new RegExp('^#{' + (level || 2) + '}\\s+(.*)$');
    var out = [];
    String(md || '').split('\n').forEach(function (l, i) { var m = re.exec(l); if (m) out.push({ title: m[1].trim(), line: i }); });
    return out;
  }
  // The lines of one ## section (heading included); before the first ## when title is ''.
  function sectionRange(md, title, level) {
    var lines = String(md || '').split('\n'), hs = headings(md, level || 2);
    if (!title) return { from: 0, to: hs.length ? hs[0].line : lines.length };
    for (var k = 0; k < hs.length; k++) {
      if (hs[k].title === title) {
        var to = lines.length;
        for (var j = hs[k].line + 1; j < lines.length; j++) { if (/^#{1,2}\s/.test(lines[j])) { to = j; break; } }
        return { from: hs[k].line, to: to };
      }
    }
    return null;
  }
  function section(md, title) {
    var r = sectionRange(md, title);
    return r ? String(md || '').split('\n').slice(r.from, r.to).join('\n') : '';
  }

  /* ── An editable note: Read (rendered, ticks work) / Edit (the Markdown) ── */
  // opts: { scene: '## title' to show one section, onLink(path), onCue(text), compact, emptyText }
  function editor(host, path, opts) {
    opts = opts || {};
    var mode = opts.mode || 'read', timer = null, dirty = false;
    // Undo / Redo (2026-10-30): this editor's own history of the text, so
    // what the app writes in (a [[ link, a B or I) is undone like typing.
    var hist = { past: [], future: [], last: null, t: 0 };
    host.classList.add('vn-ed');
    function note() { return get(path); }
    function full() { return (note() || {}).content || ''; }
    function shown() {
      if (!opts.scene) return full();
      var r = sectionRange(full(), opts.scene.title || '');
      return r ? full().split('\n').slice(r.from, r.to).join('\n') : '';
    }
    function setShown(text) {
      if (!opts.scene) return text;
      var all = full().split('\n'), r = sectionRange(full(), opts.scene.title || '');
      if (!r) return full() + '\n' + text;
      return all.slice(0, r.from).concat(text.split('\n'), all.slice(r.to)).join('\n');
    }
    function status(t) { var s = host.querySelector('.vn-status'); if (s) s.textContent = t; }
    function commit(text) {
      dirty = true; status('…');
      clearTimeout(timer);
      timer = setTimeout(function () {
        save(path, text).then(function () { dirty = false; status('saved'); }, function (e) { status('not saved: ' + ((e && e.message) || e)); });
      }, 600);
    }
    function draw() {
      var n = note();
      var fl = folderLabel(dirOf(path));
      var head = opts.hideHead ? '' : '<div class="vn-bar"><span class="vn-file" title="' + esc(path) + '">' + esc((fl ? fl + ' › ' : '') + title(path)) + '</span>' +
        '<span class="vn-status">' + (n ? '' : 'new note') + '</span>' +
        '<span class="vn-modes"><button type="button" data-vmode="read" class="' + (mode === 'read' ? 'on' : '') + '">Read</button><button type="button" data-vmode="edit" class="' + (mode === 'edit' ? 'on' : '') + '">✎ Edit</button></span></div>';
      var body;
      if (mode === 'edit') body = tbHtml() + '<textarea class="vn-ta" spellcheck="true">' + esc(shown()) + '</textarea>';
      else body = '<div class="vn-body">' + (shown().trim() ? render(shown(), opts) : '<p class="vn-empty">' + esc(opts.emptyText || 'Nothing here yet — ✎ Edit to write.') + '</p>') + '</div>';
      host.innerHTML = head + body;
      var ta = host.querySelector('.vn-ta');
      if (ta) {
        var grow = function () { if (opts.grow) { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 4) + 'px'; } };
        grow();
        if (hist.last == null) hist.last = ta.value;
        ta.addEventListener('input', function () {
          var now = Date.now();
          if (ta.value !== hist.last) {
            // One step per burst of typing (a pause of 0.8 s starts a new one).
            if (now - hist.t > 800 || !hist.past.length) { hist.past.push(hist.last); if (hist.past.length > 200) hist.past.shift(); }
            hist.last = ta.value; hist.future = []; hist.t = now; urState();
          }
          grow(); commit(setShown(ta.value));
        });
        ta.addEventListener('keydown', function (e) {
          if (sugEl) return;   // the [[ list has the keys
          if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); indent(ta, e.shiftKey); return; }
          if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && ta.selectionStart === ta.selectionEnd && listEnter(ta)) { e.preventDefault(); return; }
          if (!(e.ctrlKey || e.metaKey)) return;
          var k0 = e.key.toLowerCase();
          if (k0 === 'b' || k0 === 'i') { e.preventDefault(); mdApply(ta, k0); return; }
          var k = e.key.toLowerCase();
          if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
          else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
        });
        linkSuggest(ta, path);
        urState();
      }
    }
    // The formatting bar (2026-10-31): Evidence's tools, a checklist and
    // [[ ]], then Undo / Redo.
    function tbHtml() {
      return '<div class="vn-tb">' + [['h1', 'H1', 'Heading'], ['h2', 'H2', 'Smaller heading'], ['b', '<b>B</b>', 'Bold (Ctrl+B)'], ['i', '<i>I</i>', 'Italic (Ctrl+I)'],
        ['ul', '&bull; List', 'Bulleted list'], ['ol', '1. List', 'Numbered list'], ['task', '&#9744; Tasks', 'Checklist'], ['q', '&#10077; Quote', 'Quote'], ['hr', '&mdash; Rule', 'Divider line'], ['link', '[[ ]]', 'Link a note']]
        .map(function (b) { return '<button type="button" data-vmd="' + b[0] + '" title="' + b[2] + '">' + b[1] + '</button>'; }).join('') +
        '<span class="vn-tb-sp"></span>' + urHtml() + '</div>';
    }
    function urHtml() { return '<span class="vn-ur"><button type="button" data-vur="undo" title="Undo (Ctrl+Z)">Undo</button><button type="button" data-vur="redo" title="Redo (Ctrl+Shift+Z)">Redo</button></span>'; }
    function urState() {
      var u = host.querySelector('[data-vur=undo]'), r = host.querySelector('[data-vur=redo]');
      if (u) u.disabled = !hist.past.length;
      if (r) r.disabled = !hist.future.length;
    }
    function setText(v) {
      var ta = host.querySelector('.vn-ta');
      if (!ta) return;
      var old = ta.value, at = 0;
      while (at < old.length && at < v.length && old.charAt(at) === v.charAt(at)) at++;
      ta.value = v; hist.last = v; hist.t = 0;
      ta.focus(); ta.selectionStart = ta.selectionEnd = Math.min(at + Math.max(0, v.length - old.length), v.length);
      if (opts.grow) { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 4) + 'px'; }
      commit(setShown(v)); urState();
    }
    function undo() { var ta = host.querySelector('.vn-ta'); if (!ta || !hist.past.length) return; hist.future.push(ta.value); setText(hist.past.pop()); }
    function redo() { var ta = host.querySelector('.vn-ta'); if (!ta || !hist.future.length) return; hist.past.push(ta.value); setText(hist.future.pop()); }
    host.addEventListener('mousedown', function (e) { if (e.target.closest('[data-vur],[data-vmd]')) e.preventDefault(); });
    host.addEventListener('click', function (e) {
      var md = e.target.closest('[data-vmd]');
      if (md) { var t = host.querySelector('.vn-ta'); if (t) mdApply(t, md.getAttribute('data-vmd')); return; }
      var ur = e.target.closest('[data-vur]');
      if (ur) { if (ur.getAttribute('data-vur') === 'undo') undo(); else redo(); return; }
      var b = e.target.closest('[data-vmode]');
      if (b) { mode = b.getAttribute('data-vmode'); draw(); if (mode === 'edit') { var t = host.querySelector('.vn-ta'); if (t) t.focus(); } return; }
      var ck = e.target.closest('.vn-ck');
      if (ck) {
        var line = +ck.getAttribute('data-vline'), text = shown();
        var next = toggleTask(text, line);
        save(path, setShown(next)).catch(function () {});
        return;
      }
      var lk = e.target.closest('[data-vlink]');
      if (lk && opts.onLink) { opts.onLink(resolveLink(lk.getAttribute('data-vlink'), path)); return; }
      var cue = e.target.closest('[data-cue]');
      if (cue && opts.onCue) opts.onCue(cue.getAttribute('data-cue'), cue);
    });
    var onChange = function () { if (mode === 'read' || !dirty) { if (mode === 'read' || document.activeElement !== host.querySelector('.vn-ta')) draw(); } };
    document.addEventListener('dg-vault', onChange);
    draw();
    return {
      setMode: function (m) { mode = m; draw(); },
      setScene: function (s) { opts.scene = s; hist = { past: [], future: [], last: null, t: 0 }; draw(); },
      undo: undo, redo: redo,
      path: function () { return path; },
      destroy: function () { document.removeEventListener('dg-vault', onChange); clearTimeout(timer); }
    };
  }
  /* Writing tools (2026-10-31), the same as Evidence's: a selection is
     wrapped, or the selected lines marked; Tab indents, Enter continues
     a list. Each change goes through 'input', so it saves and can be undone. */
  function mdApply(ta, kind) {
    var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, sel = v.slice(s, e);
    if (kind === 'b' || kind === 'i') {
      var mk = kind === 'b' ? '**' : '*', inner = sel || (kind === 'b' ? 'bold' : 'italic');
      ta.setRangeText(mk + inner + mk, s, e, 'end');
      if (!sel) ta.setSelectionRange(s + mk.length, s + mk.length + inner.length);
    } else if (kind === 'hr') {
      ta.setRangeText((s && v[s - 1] !== '\n' ? '\n' : '') + '\n---\n\n', s, e, 'end');
    } else if (kind === 'link') {
      ta.setRangeText('[[' + sel + ']]', s, e, 'end');
      if (!sel) ta.setSelectionRange(s + 2, s + 2);
    } else {
      var ls = v.lastIndexOf('\n', s - 1) + 1, le = v.indexOf('\n', e);
      if (le < 0) le = v.length;
      var prefix = { h1: '# ', h2: '## ', ul: '- ', q: '> ', task: '- [ ] ' }[kind], n = 0;
      var out = v.slice(ls, le).split('\n').map(function (l) {
        var ind = /^\s*/.exec(l)[0], body = l.slice(ind.length);
        var bare = body.replace(/^(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+•]\s+|\d+[.)]\s+|>\s?)/, '');
        if (kind === 'ol') return /^\d+[.)]\s/.test(body) ? ind + bare : ind + (++n) + '. ' + bare;
        if (kind === 'task') return /^[-*+]\s+\[[ xX]\]\s/.test(body) ? ind + bare : ind + prefix + bare;
        return body.indexOf(prefix) === 0 ? ind + bare : ind + prefix + bare;
      }).join('\n');
      ta.setRangeText(out, ls, le, 'select');
    }
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Tab / Shift+Tab: the line, or every selected line, in or out by two spaces.
  function indent(ta, out) {
    var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    var ls = v.lastIndexOf('\n', s - 1) + 1, le = v.indexOf('\n', e);
    if (le < 0) le = v.length;
    if (!out && s === e && !/^\s*([-*+]|\d+[.)])\s/.test(v.slice(ls, le))) {
      ta.setRangeText('  ', s, e, 'end');
    } else {
      var first = 0, total = 0;
      var lines = v.slice(ls, le).split('\n').map(function (l, k) {
        var d = out ? -Math.min(2, /^ */.exec(l)[0].length) : 2;
        if (k === 0) first = d; total += d;
        return d < 0 ? l.slice(-d) : '  ' + l;
      });
      ta.setRangeText(lines.join('\n'), ls, le, 'preserve');
      ta.setSelectionRange(Math.max(ls, s + first), Math.max(ls, e + total));
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Enter in a list carries it on (the next number, - [ ], > ); Enter on an
  // empty item ends the list.
  function listEnter(ta) {
    var v = ta.value, s = ta.selectionStart, ls = v.lastIndexOf('\n', s - 1) + 1, line = v.slice(ls, s);
    var m = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)([.)])\s+|>\s?)(.*)$/.exec(line);
    if (!m) return false;
    if (!m[5].trim() && v.slice(s, (v.indexOf('\n', s) + 1 || v.length + 1) - 1).trim() === '') {
      ta.setRangeText('', ls, s, 'end');
    } else {
      var next = m[3] ? (+m[3] + 1) + m[4] + ' ' : /\[[ xX]\]/.test(m[2]) ? m[2].replace(/\[[xX]\]/, '[ ]') : m[2];
      ta.setRangeText('\n' + m[1] + next, s, s, 'end');
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  /* [[ suggestions, as in Obsidian (2026-10-30): typing [[ in any note
     lists the vault's notes under the cursor, narrowing as you type; a tap,
     Enter or Tab writes the link and closes it with ]]. */
  var sugEl = null;
  function closeSuggest() { if (sugEl) { sugEl.remove(); sugEl = null; } }
  function caretXY(ta, pos) {
    var cs = getComputedStyle(ta), m = document.createElement('div');
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderLeftWidth', 'boxSizing', 'whiteSpace', 'wordWrap', 'tabSize'].forEach(function (k) { m.style[k] = cs[k]; });
    m.style.position = 'absolute'; m.style.visibility = 'hidden'; m.style.whiteSpace = 'pre-wrap'; m.style.wordWrap = 'break-word';
    m.style.width = ta.clientWidth + 'px'; m.style.left = '-9999px'; m.style.top = '0';
    m.textContent = ta.value.slice(0, pos);
    var mk = document.createElement('span'); mk.textContent = '\u200b'; m.appendChild(mk);
    document.body.appendChild(m);
    var x = mk.offsetLeft, y = mk.offsetTop + mk.offsetHeight;
    m.remove();
    var r = ta.getBoundingClientRect();
    return { x: r.left + x - ta.scrollLeft, y: r.top + y - ta.scrollTop };
  }
  function linkName(n, all) {
    var t = title(n.path), same = all.filter(function (x) { return title(x.path).toLowerCase() === t.toLowerCase(); }).length;
    return same > 1 ? n.path.replace(/\.md$/i, '') : t;
  }
  function linkSuggest(ta, from) {
    var at = -1, q = '', hits = [], sel = 0;
    function find() {
      var pos = ta.selectionStart, before = ta.value.slice(0, pos), m = /\[\[([^\[\]\n|#]*)$/.exec(before);
      if (!m || ta.selectionStart !== ta.selectionEnd) { at = -1; closeSuggest(); return; }
      at = pos - m[1].length; q = m[1].toLowerCase().trim();
      var all = notes(), top = String(from || '').split('/')[0];
      hits = all.filter(function (n) { return n.path !== from && (!q || n.path.toLowerCase().indexOf(q) >= 0); }).map(function (n) {
        var t = title(n.path).toLowerCase();
        return { n: n, rank: !q ? 0 : t.indexOf(q) === 0 ? 0 : t.indexOf(q) >= 0 ? 1 : 2, near: n.path.split('/')[0] === top ? 0 : 1 };
      }).sort(function (a, b) { return a.rank - b.rank || a.near - b.near || (b.n.updated_at || 0) - (a.n.updated_at || 0) || title(a.n.path).localeCompare(title(b.n.path)); }).slice(0, 8).map(function (h) { return h.n; });
      sel = 0;
      show(all);
    }
    function show(all) {
      if (!hits.length) { closeSuggest(); return; }
      if (!sugEl) { sugEl = document.createElement('div'); sugEl.className = 'vn-sug'; sugEl.setAttribute('role', 'listbox'); document.body.appendChild(sugEl); }
      sugEl.innerHTML = hits.map(function (n, i) {
        var d = folderLabel(dirOf(n.path));
        return '<button type="button" class="vn-sugi' + (i === sel ? ' on' : '') + '" data-i="' + i + '" role="option"><b>' + esc(title(n.path)) + '</b>' + (d ? '<small>' + esc(d) + '</small>' : '') + '</button>';
      }).join('');
      sugEl._all = all;
      var c = caretXY(ta, at), w = Math.min(320, window.innerWidth - 16);
      sugEl.style.width = w + 'px';
      sugEl.style.left = Math.max(8, Math.min(c.x, window.innerWidth - w - 8)) + 'px';
      var below = c.y + 4, h = sugEl.offsetHeight, vv = window.visualViewport, bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
      sugEl.style.top = (below + h > bottom - 8 ? Math.max(8, c.y - h - 26) : below) + 'px';
      sugEl.onmousedown = function (e) { e.preventDefault(); };
      sugEl.onclick = function (e) { var b = e.target.closest('[data-i]'); if (b) pick(+b.getAttribute('data-i')); };
    }
    function pick(i) {
      var n = hits[i];
      if (!n) return;
      var name = linkName(n, notes()), pos = ta.selectionStart, rest = ta.value.slice(pos);
      var close = /^[^\[\]\n]*\]\]/.exec(rest), tailCut = close ? close[0].length : 0;
      ta.value = ta.value.slice(0, at) + name + ']]' + rest.slice(tailCut);
      ta.selectionStart = ta.selectionEnd = at + name.length + 2;
      closeSuggest(); at = -1;
      ta.focus();
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.addEventListener('input', find);
    ta.addEventListener('click', find);
    ta.addEventListener('keydown', function (e) {
      if (!sugEl || at < 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; show(sugEl._all); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); at = -1; }
    });
    ta.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== ta) closeSuggest(); }, 150); });
  }

  // [[Name]] -> the note's path: same folder first, then anywhere by name.
  function resolveLink(target, from) {
    var name = String(target || '').split('#')[0].trim();
    if (!name) return from;
    var want = cleanPath(name), base = want.split('/').pop().toLowerCase();
    if (get(want)) return want;
    var dir = from && from.indexOf('/') >= 0 ? from.slice(0, from.lastIndexOf('/') + 1) : '';
    if (get(dir + want)) return dir + want;
    var hit = notes().filter(function (n) { return n.path.split('/').pop().toLowerCase() === base; })[0];
    return hit ? hit.path : dir + want;
  }

  /* ── Pick a note (or make one) ── */
  function modal(html, cls) {
    var wrap = document.createElement('div');
    wrap.className = 'vn-modal ' + (cls || '');
    wrap.innerHTML = '<div class="vn-sheet" role="dialog">' + html + '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.closest('[data-vclose]')) wrap.remove(); });
    return wrap;
  }
  // opts: { title, newPath (suggested name for a new note), onPick(path), html: [{ id, title }] HTML pages, onPickHtml(id) }
  function picker(opts) {
    opts = opts || {};
    var w = modal('<div class="vn-mh"><b>' + esc(opts.title || 'Pick a note') + '</b><button type="button" data-vclose>✕</button></div>' +
      '<input class="vn-search" placeholder="Search notes…" type="search">' +
      '<div class="vn-plist"><div class="vn-empty">Loading…</div></div>' +
      '<div class="vn-new"><input class="vn-newpath" placeholder="New note: Folder/Name" value="' + esc(opts.newPath || '') + '"><button type="button" class="vn-btn p" data-vnew>+ New note</button></div>');
    var q = w.querySelector('.vn-search'), list = w.querySelector('.vn-plist');
    function draw() {
      var term = q.value.trim().toLowerCase();
      var ns = notes().filter(function (n) { return !term || n.path.toLowerCase().indexOf(term) >= 0; });
      var groups = {};
      ns.forEach(function (n) { var d = folderLabel(dirOf(n.path)); (groups[d] = groups[d] || []).push(n); });
      var html = Object.keys(groups).sort(byName).map(function (d) {
        return (d ? '<div class="vn-pdir">' + esc(d) + '</div>' : '') + groups[d].sort(function (a, b) { return byName(title(a.path), title(b.path)); }).map(function (n) {
          return '<button type="button" class="vn-pi" data-vpath="' + esc(n.path) + '">' + esc(title(n.path)) + '</button>';
        }).join('');
      }).join('');
      var hp = (opts.html || []).filter(function (h) { return !term || String(h.title).toLowerCase().indexOf(term) >= 0; });
      if (hp.length) html += '<div class="vn-pdir">HTML pages (uploaded)</div>' + hp.map(function (h) { return '<button type="button" class="vn-pi" data-vhtml="' + esc(h.id) + '">' + esc(h.title) + '</button>'; }).join('');
      list.innerHTML = html || '<div class="vn-empty">' + (notes().length ? 'Nothing matches.' : 'No notes yet. Set up the iCloud sync (Notes vault) or make a new note below.') + '</div>';
    }
    q.addEventListener('input', draw);
    load().then(draw, function (e) { list.innerHTML = '<div class="vn-empty">Could not load the vault: ' + esc((e && e.message) || e) + '</div>'; });
    w.addEventListener('click', function (e) {
      var p = e.target.closest('[data-vpath]');
      if (p) { w.remove(); if (opts.onPick) opts.onPick(p.getAttribute('data-vpath')); return; }
      var h = e.target.closest('[data-vhtml]');
      if (h) { w.remove(); if (opts.onPickHtml) opts.onPickHtml(h.getAttribute('data-vhtml')); return; }
      if (e.target.closest('[data-vnew]')) {
        var path = cleanPath(w.querySelector('.vn-newpath').value);
        if (!path) return;
        var make = get(path) ? Promise.resolve(path) : save(path, '# ' + title(path) + '\n\n');
        make.then(function () { w.remove(); if (opts.onPick) opts.onPick(path); });
      }
    });
    setTimeout(function () { q.focus(); }, 0);
    return w;
  }

  /* ── Notes vault settings: the Shortcut sync, import, export ── */
  function newKey() {
    var a = new Uint8Array(24);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function loadJsZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = function () { res(window.JSZip); };
      s.onerror = function () { rej(new Error('Could not load the zip library.')); };
      document.head.appendChild(s);
    });
  }
  function exportZip() {
    return Promise.all([load(), loadJsZip()]).then(function (r) {
      var zip = new r[1]();
      notes().forEach(function (n) { zip.file(n.path, n.content || ''); });
      return zip.generateAsync({ type: 'blob' });
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dg-vault-' + new Date().toISOString().slice(0, 10) + '.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    });
  }
  function importFiles(files, folder) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return /\.md$/i.test(f.name); });
    return Promise.all(list.map(function (f) {
      return f.text().then(function (text) {
        var rel = f.webkitRelativePath || f.name;
        return save((folder ? folder.replace(/\/+$/, '') + '/' : '') + rel, text.replace(/\r\n/g, '\n'));
      });
    })).then(function (r) { return r.length; });
  }
  function settings() {
    var w = modal('<div class="vn-mh"><b>Notes vault</b><button type="button" data-vclose>✕</button></div><div class="vn-set"><div class="vn-empty">Loading…</div></div>', 'vn-wide');
    var box = w.querySelector('.vn-set');
    function draw(cfg) {
      var last = cfg.last_sync;
      box.innerHTML =
        '<p class="vn-lead">Your Obsidian notes live in iCloud; A-Cell keeps a private copy (only you, as Handler, can read it). An Apple Shortcut on your phone keeps the two in step: it sends your vault folder here and saves back what you changed in A-Cell.</p>' +
        '<div class="vn-row"><span>Last sync</span><b>' + (last ? new Date(last.at).toLocaleString() + ' · ' + last.files + ' notes · ' + (last.created + last.updated) + ' in, ' + last.sent + ' out' + (last.conflicts ? ', ' + last.conflicts + ' kept twice' : '') : 'never') + '</b></div>' +
        '<div class="vn-row"><span>Notes in A-Cell</span><b>' + notes().length + '</b></div>' +
        '<h4>1 · Sync key</h4>' +
        (cfg.key ? '<div class="vn-key"><code class="vn-keyv">' + esc(cfg.key) + '</code><button type="button" class="vn-btn" data-vcopy>Copy</button><button type="button" class="vn-btn" data-vrekey>New key</button></div>'
          : '<div class="vn-key"><button type="button" class="vn-btn p" data-vrekey>Make a sync key</button></div>') +
        '<div class="vn-row"><span>Address</span><code class="vn-url">' + SYNC_URL + '</code></div>' +
        '<h4>2 · The Shortcut (once, on your iPhone)</h4>' +
        '<ol class="vn-steps">' +
        '<li>Shortcuts → <b>+</b> → name it <b>Sync DG vault</b>.</li>' +
        '<li><b>Get Contents of Folder</b>: pick your vault folder in iCloud Drive (Obsidian ›  your vault). Turn <b>Recursive</b> on.</li>' +
        '<li><b>Filter Files</b>: where <i>File Extension</i> is <i>md</i>.</li>' +
        '<li><b>Repeat with Each</b> (the filtered files). Inside it:' +
        '<ol><li><b>Get Details of Files</b>: <i>File Path</i> of Repeat Item.</li>' +
        '<li><b>Replace Text</b>: in that path, replace the part up to and including your vault folder\'s name and "/" with nothing (so "Pale Lantern/Act II.md" is left).</li>' +
        '<li><b>Get Text from Input</b>: Repeat Item.</li>' +
        '<li><b>Dictionary</b>: <i>path</i> = Updated Text, <i>text</i> = Text.</li></ol>End Repeat.</li>' +
        '<li><b>Dictionary</b>: <i>key</i> = your sync key (above), <i>files</i> = Repeat Results (as an Array).</li>' +
        '<li><b>Get Contents of URL</b>: the address above, Method <b>POST</b>, Request Body <b>File</b> = Dictionary.</li>' +
        '<li><b>Get Dictionary Value</b> <i>write</i>, then <b>Repeat with Each</b>:' +
        '<ol><li><b>Get Dictionary Value</b> <i>text</i> → <b>Set Name</b> to the item\'s <i>path</i>.</li>' +
        '<li><b>Save File</b> to your vault folder, Subpath = the item\'s <i>path</i>, <b>Ask Where to Save</b> off, <b>Overwrite If File Exists</b> on.</li></ol>End Repeat.</li>' +
        '<li>Optional: Automation → <b>App</b> → Obsidian <b>is closed</b> → Run <b>Sync DG vault</b>, Run Immediately.</li>' +
        '</ol>' +
        '<p class="vn-small">Notes changed on both sides are kept twice ("Name (A-Cell).md") rather than one overwriting the other. A note deleted on the phone goes from A-Cell too, unless you changed it here since.</p>' +
        '<h4>Without the Shortcut</h4>' +
        '<div class="vn-key"><label class="vn-btn">⇪ Import .md files<input type="file" accept=".md,text/markdown" multiple hidden data-vimport></label><button type="button" class="vn-btn" data-vexport>⇩ Export all as .zip</button><span class="vn-status"></span></div>';
    }
    var cfgRef = null, cfgNow = {};
    fb().then(function (f) {
      cfgRef = f.firestore().collection('vault_meta').doc('config');
      return Promise.all([cfgRef.get(), load()]);
    }).then(function (r) { cfgNow = (r[0].exists && r[0].data()) || {}; draw(cfgNow); },
      function (e) { box.innerHTML = '<div class="vn-empty">Could not open the vault settings: ' + esc((e && e.message) || e) + '</div>'; });
    w.addEventListener('click', function (e) {
      if (e.target.closest('[data-vrekey]')) {
        var go = cfgNow.key ? (window.dgConfirm ? window.dgConfirm('Make a new key? The Shortcut needs the new one pasted in.', { ok: 'New key', cancel: 'Keep it' }) : Promise.resolve(window.confirm('Make a new key?'))) : Promise.resolve(true);
        go.then(function (yes) {
          if (!yes) return;
          var k = newKey();
          cfgRef.set({ key: k, key_made_at: Date.now() }, { merge: true }).then(function () { cfgNow.key = k; draw(cfgNow); });
        });
        return;
      }
      if (e.target.closest('[data-vcopy]')) {
        try { navigator.clipboard.writeText(cfgNow.key); e.target.textContent = 'Copied'; } catch (err) { /* select it by hand */ }
        return;
      }
      if (e.target.closest('[data-vexport]')) {
        var st = box.querySelector('.vn-status'); st.textContent = 'Packing…';
        exportZip().then(function () { st.textContent = 'Downloaded.'; }, function (err) { st.textContent = (err && err.message) || String(err); });
      }
    });
    w.addEventListener('change', function (e) {
      var inp = e.target.closest('[data-vimport]');
      if (!inp) return;
      var st = box.querySelector('.vn-status'); st.textContent = 'Importing…';
      importFiles(inp.files).then(function (n) { st.textContent = n + ' note' + (n === 1 ? '' : 's') + ' imported.'; draw(cfgNow); }, function (err) { st.textContent = (err && err.message) || String(err); });
    });
    return w;
  }

  window.dgVault = {
    load: load, notes: notes, get: get, save: save, remove: remove, id: id, cleanPath: cleanPath, title: title,
    dirOf: dirOf, folderLabel: folderLabel, byName: byName,
    render: render, headings: headings, section: section, sectionRange: sectionRange, toggleTask: toggleTask,
    editor: editor, picker: picker, settings: settings, resolveLink: resolveLink, modal: modal, esc: esc,
    importFiles: importFiles, exportZip: exportZip, SYNC_URL: SYNC_URL
  };
})();
