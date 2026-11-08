/* A-Cell's Players tab (v3.12.0): beside an Agent's stats and skills,
   their player file -- the Handler's own note on them in the vault,
   Players/<Agent name>.md:

     ## Handler notes            the Handler writes these
     ## Sheet changes            added when the Handler edits the sheet
                                 (with the reason), and by Debrief (what
                                 a session cost them)
     ## Quick notes from play    added by Debrief, from the desk

   ✎ Edit sheet opens the Agent File paper (the same one the players
   use, assets/agent-paper.js, loaded the first time) straight into Edit;
   saving asks the Handler what changed and why instead of the players'
   Oath, and logs it in the file.

   window.dgAcPlayers = { ensureFile(code), append(path, section, lines),
     editSheet(code), stamp(session) } */
(function () {
  'use strict';
  var A = window.dgAc;
  if (!A || window.dgAcPlayers) return;
  var esc = A.esc;
  function V() { return window.dgVault; }
  function R() { return window.dgAcellRoster; }

  var SECTIONS = ['Handler notes', 'Sheet changes', 'Quick notes from play'];
  function template(a) {
    var c = (A.cells().filter(function (x) { return x.member_codes.indexOf(a.code) >= 0; })[0] || {});
    return '---\nplayer: ' + (a.player || '') + '\nagent code: ' + a.code + '\ncell: ' + (c.name || '') + '\nprofession: ' + (a.profession || '') + '\n---\n' +
      '# ' + a.name + '\n\n## Handler notes\n\n\n## Sheet changes\n\n\n## Quick notes from play\n\n';
  }
  function ensureFile(code) {
    var a = A.agent(code) || { code: code, name: code };
    return V().load().catch(function () {}).then(function () {
      var path = A.playerPath(a);
      return V().get(path) ? path : V().save(path, template(a), { why: 'player file for ' + a.name });
    });
  }
  // Adds lines ("- …") at the end of a ## section, making it if it's missing.
  function append(path, section, lines) {
    if (!lines || !lines.length) return Promise.resolve(path);
    var md = ((V().get(path) || {}).content || '').replace(/\s+$/, '');
    var all = md.split('\n'), r = V().sectionRange(md, section);
    if (!r) {
      all = all.concat(['', '## ' + section, ''], lines);
    } else {
      var end = r.to;
      while (end > r.from + 1 && !all[end - 1].trim()) end--;
      all = all.slice(0, end).concat(lines, all.slice(end).length ? [''] : [], all.slice(end));
    }
    return V().save(path, all.join('\n').replace(/\n{3,}/g, '\n\n') + '\n', { why: section + ': ' + lines.length + ' line' + (lines.length === 1 ? '' : 's') });
  }
  // "2026-11-01 · Session 4 —" for a log line.
  function stamp(s) {
    return new Date().toISOString().slice(0, 10) + (s ? ' · ' + s.name : '');
  }

  /* ── The file beside the Agent ── */
  var layout = document.querySelector('#panel-play .play-layout');
  var side = document.createElement('section');
  side.className = 'ac-pfile';
  side.id = 'ac-pfile';
  side.innerHTML = '<div class="ac-none">Open an Agent to see their file.</div>';
  layout.appendChild(side);
  layout.classList.add('ac-players');
  var cur = { code: '', path: '', ed: null };

  /* ── The Handler's own Agent notes (2026-11-05) ──
     A note of theirs on this Agent ("André Demore - Agent Mastery.md")
     is suggested by its name; once confirmed it gets "agent code: <code>"
     in its properties and becomes the player file (A.playerPath finds it
     by that, wherever it moves). What A-Cell kept in Players/<name>.md
     is merged in under the same headings, lines it has already skipped;
     Players/ itself is the Handler's to delete in Obsidian. */
  function plain(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function nameWords(name) {
    return plain(String(name || '').replace(/["“”'‘’][^"“”'‘’]*["“”'‘’]/g, ' ')).split(/[^a-z0-9]+/).filter(function (w) { return w.length > 1; });
  }
  function candidates(a) {
    var want = nameWords(a.name);
    if (!want.length) return [];
    return V().notes().filter(function (n) {
      // Not A-Cell's own copy (nor a "(A-Cell)" copy the sync kept); the Handler's notes in Players/ count.
      if (n.path === A.defaultPlayerPath(a.name) || /\(A-Cell( \d+)?\)\.md$/i.test(n.path)) return false;
      var have = nameWords(V().title(n.path));
      return want.every(function (w) { return have.indexOf(w) >= 0; });
    }).map(function (n) {
      // An Agent's note says so: "Agent" in its name, or an agent tag / agent code.
      var tl = nameWords(V().title(n.path)), fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(n.content || '');
      var score = (tl.indexOf('agent') >= 0 ? 2 : 0) + (fm && /(^|\n)\s*(-\s*|tags:\s*\[?[^\n]*)\bagent\b|agent[ _]?code:/i.test(fm[1]) ? 2 : 0);
      return { path: n.path, score: score, len: V().title(n.path).length };
    }).sort(function (x, y) { return y.score - x.score || x.len - y.len; }).map(function (x) { return x.path; });
  }
  function linkFile(a, path) {
    var L = window.dgAcm && window.dgAcm.layout, n = V().get(path);
    if (!n || !L) return Promise.reject(new Error('That note is gone.'));
    return V().save(path, L.setFm(n.content || '', [['agent code', a.code]]), { why: 'linked as ' + a.name + '\'s player file' })
      .then(function () { return mergeInto(a, path); });
  }
  function mergeInto(a, path) {
    var old = A.defaultPlayerPath(a.name), src = V().get(old);
    if (!src || old === path) return Promise.resolve(0);
    var md = src.content || '', added = 0;
    return SECTIONS.reduce(function (p, sec) {
      return p.then(function () {
        var r = V().sectionRange(md, sec);
        if (!r) return null;
        var have = {};
        ((V().get(path) || {}).content || '').split('\n').forEach(function (l) { if (l.trim()) have[l.trim()] = true; });
        var lines = md.split('\n').slice(r.from + 1, r.to).filter(function (l) { return l.trim() && !have[l.trim()]; });
        added += lines.length;
        return lines.length ? append(path, sec, lines) : null;
      });
    }, Promise.resolve()).then(function () { return added; });
  }
  function linkBar(a) {
    var el = side.querySelector('.ac-pf-link');
    if (!el || !V().notes().length) return;
    var linked = A.linkedFile(a.code, a.name), old = A.defaultPlayerPath(a.name), hasOld = !!V().get(old);
    if (linked) {
      el.innerHTML = '<span class="ac-pf-path">' + esc(linked.replace(/\.md$/i, '')) + '</span><button type="button" class="ac-lnk" data-pf="pick">Change…</button>' +
        (hasOld && linked !== old ? '<span class="ac-pf-old">A-Cell\'s old copy, ' + esc(old.replace(/\.md$/i, '')) + ', is merged in here: delete it in Obsidian · <button type="button" class="ac-lnk" data-pf="merge">merge again</button></span>' : '');
      return;
    }
    var c = candidates(a)[0];
    el.innerHTML = c ? '<span class="ac-pf-ask">Is this your note on ' + esc(a.name) + '? <b>' + esc(c.replace(/\.md$/i, '')) + '</b></span>' +
        '<button type="button" class="ac-btn p" data-pf="use" data-path="' + esc(c) + '">Use it</button><button type="button" class="ac-lnk" data-pf="pick">Pick another…</button>'
      : '<span class="ac-pf-path">' + esc(old.replace(/\.md$/i, '')) + '</span><button type="button" class="ac-lnk" data-pf="pick">Use one of your notes…</button>';
  }
  function useFile(a, path) {
    var st = side.querySelector('.ac-pf-link');
    if (st) st.innerHTML = '<span class="ac-pf-ask">Linking…</span>';
    linkFile(a, path).then(function (n) {
      show(a.code);
      var el = side.querySelector('.ac-pf-link');
      if (el && n) el.insertAdjacentHTML('beforeend', '<span class="ac-pf-old">' + n + ' line' + (n === 1 ? '' : 's') + ' merged in from A-Cell\'s copy. Delete ' + esc(A.defaultPlayerPath(a.name)) + ' in Obsidian when you\'re happy.</span>');
    }, function (err) { if (st) st.innerHTML = '<span class="ac-pf-ask">' + esc((err && err.message) || err) + '</span>'; });
  }

  function show(code) {
    var a = A.agent(code) || { code: code, name: code };
    var path = A.playerPath(a);
    if (cur.code !== code || cur.path !== path) {
      if (cur.ed) { cur.ed.destroy(); cur.ed = null; }
      cur.code = code; cur.path = path;
      side.innerHTML = '<div class="ac-pf-hd"><span class="ac-t">' + esc(a.name) + '<small>player file</small></span>' +
        '<button type="button" class="ac-btn p" data-pf="edit">✎ Edit sheet</button></div><div class="ac-pf-link"></div><div class="ac-pf-body"><div class="ac-none">Loading…</div></div>';
    }
    V().load().then(function () { var p2 = A.playerPath(a); if (p2 !== cur.path) { cur.code = ''; show(code); return; } linkBar(a); drawBody(); }, function (err) {
      side.querySelector('.ac-pf-body').innerHTML = '<div class="ac-none">Could not load the vault: ' + esc((err && err.message) || err) + '</div>';
    });
  }
  function drawBody() {
    var body = side.querySelector('.ac-pf-body');
    if (!body) return;
    if (!V().get(cur.path)) {
      if (cur.ed) { cur.ed.destroy(); cur.ed = null; }
      body.innerHTML = '<p class="ac-none">No player file yet. It keeps your notes on this Agent, the changes you make to their sheet, and the quick notes from play — in your vault, so Obsidian has it too.</p>' +
        '<button type="button" class="ac-btn" data-pf="start">Start the player file</button>';
      return;
    }
    if (!cur.ed) {
      body.innerHTML = '';
      cur.ed = V().editor(body, cur.path, { hideHead: false, onLink: function (p) { A.openNote(p); } });
    }
  }
  side.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pf]');
    if (!b) return;
    var a = b.getAttribute('data-pf');
    var ag = A.agent(cur.code) || { code: cur.code, name: cur.code };
    if (a === 'start') ensureFile(cur.code).then(drawBody);
    else if (a === 'edit') editSheet(cur.code);
    else if (a === 'use') useFile(ag, b.getAttribute('data-path'));
    else if (a === 'pick') V().picker({ title: 'Your note on ' + ag.name, onPick: function (p) { useFile(ag, p); } });
    else if (a === 'merge') mergeInto(ag, A.playerPath(ag)).then(function (n) { show(ag.code); var el = side.querySelector('.ac-pf-link'); if (el) el.insertAdjacentHTML('beforeend', '<span class="ac-pf-old">' + (n ? n + ' line' + (n === 1 ? '' : 's') + ' merged in.' : 'Nothing new to merge.') + ' Delete ' + esc(A.defaultPlayerPath(ag.name)) + ' in Obsidian.</span>'); });
  });
  document.addEventListener('dg-acell-agent', function (e) { show(e.detail.code); });
  document.addEventListener('dg-vault', function () { if (cur.code && !cur.ed) drawBody(); });

  /* ── Edit sheet: the Agent File paper, with the Handler's reason ── */
  var paperP = null;
  function loadPaper() {
    if (window.dgAgentPaper && window.dgAgentLive && window.dgStore) return Promise.resolve();
    if (paperP) return paperP;
    function css(href) {
      if (document.querySelector('link[href="' + href + '"]')) return;
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
    }
    function js(src) {
      return new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); };
        document.body.appendChild(s);
      });
    }
    ['assets/agent-sheet.css', 'assets/agent-paper.css', 'assets/agent-wear.css'].forEach(css);
    paperP = ['assets/dg-store.js', 'assets/agent-rules.js', 'assets/agent-live.js', 'assets/agent-paper.js'].reduce(function (p, src) {
      return p.then(function () { return js(src); });
    }, Promise.resolve()).catch(function (err) { paperP = null; throw err; });
    return paperP;
  }
  function reason(who) {
    return new Promise(function (res) {
      var w = A.modal('<div class="vn-mh"><b>Save ' + esc(who.name) + '\'s sheet</b><button type="button" data-vclose>✕</button></div>' +
        '<p class="vn-lead">' + (who.changes.length ? 'Changes: <b>' + esc(who.changes.join(', ')) + '</b>' : 'No changes to the numbers.') + '</p>' +
        '<label class="ac-form"><span class="ac-sub">What happened (goes in their player file)</span><textarea class="vn-search ac-why" rows="3" placeholder="e.g. pushed through the fog; improvement roll"></textarea></label>' +
        '<label class="ac-tell"><input type="checkbox" class="ac-tellck" checked> Tell ' + esc((A.agent(who.code) || {}).player || 'the player') + ' (a note from the Handler on their Agent File)</label>' +
        '<div class="vn-new" style="justify-content:flex-end"><button type="button" class="vn-btn" data-no>Back to editing</button><button type="button" class="vn-btn p" data-yes>Save</button></div>', 'ac-ask ac-reason');
      setTimeout(function () { w.querySelector('.ac-why').focus(); }, 0);
      var done = false;
      function finish(ok) {
        if (done) return; done = true;
        var why = w.querySelector('.ac-why').value.trim(), tell = w.querySelector('.ac-tellck').checked;
        w.remove();
        res(ok);
        if (!ok) return;
        var line = '- ' + stamp(A.session()) + ' · by Handler: ' + (who.changes.length ? who.changes.join(', ') : 'sheet edited') + (why ? ' — ' + why : '');
        ensureFile(who.code).then(function (path) { return append(path, 'Sheet changes', [line + (tell ? ' · told the player' : '')]); }).catch(function (err) { console.error('a-cell: could not log the sheet change', err); });
        if (tell) tellPlayer(who.code, (who.changes.length ? who.changes.join(', ') : 'Your sheet was edited') + (why ? ': ' + why : '.'));
      }
      w.addEventListener('click', function (e) {
        if (e.target.closest('[data-yes]')) finish(true);
        else if (e.target.closest('[data-no]') || e.target.closest('[data-vclose]') || e.target === w) finish(false);
      });
    });
  }
  // characters/{code}.handler_notes: the player's Agent File shows the new ones until read.
  function tellPlayer(code, text) {
    return window.dgAcellApi.handler().then(function (f) {
      var ref = f.firestore().collection('characters').doc(code);
      return ref.get().then(function (snap) {
        var cur = ((snap && snap.exists && snap.data()) || {}).handler_notes || [];
        return ref.set({ handler_notes: cur.concat([{ at: Date.now(), text: text }]).slice(-20) }, { merge: true });
      });
    }).catch(function (err) { console.error('a-cell: could not tell the player', err); });
  }
  // A profession key as its title, the way Agent Hub shows it.
  function profTitle(key) {
    if (!key) return '';
    if (window.professions && window.professions[key] && window.professions[key].title) return window.professions[key].title;
    return A.profLabel(key);
  }
  // opts.view: open it as it is (the desk: vitals ±, Roll SAN), not in Edit.
  function editSheet(code, opts) {
    opts = opts || {};
    var a = A.agent(code) || { code: code, name: code };
    var w = A.modal('<div class="vn-mh"><b>' + esc(a.name) + ' · Agent File</b><button type="button" data-vclose>Done</button></div><div class="ac-paperhost"><div class="ac-none">Opening the Agent File…</div></div>', 'vn-wide ac-sheetmodal');
    var obs = new MutationObserver(function () {
      if (w.isConnected) return;
      obs.disconnect();
      // Their view here follows the saved sheet.
      if (R() && R().selected() === code) setTimeout(function () { R().open(code, true); }, 900);
    });
    obs.observe(document.body, { childList: true });
    loadPaper().then(function () {
      var host = w.querySelector('.ac-paperhost'), brief = (R().briefs() || {})[code] || {}, c = A.cells().filter(function (x) { return x.member_codes.indexOf(code) >= 0; })[0];
      var photo = (window.dgMainPhoto ? window.dgMainPhoto(brief) : '') || brief.face_plate_url || '';
      var picId = 'ac-paperpic-' + code.replace(/[^A-Za-z0-9]/g, '_'), picHtml = '';
      function fillPic() {
        var box = document.getElementById(picId);
        if (!box) return;
        if (picHtml) { box.innerHTML = picHtml; return; }
        if (/^(https?:|data:)/.test(photo)) { picHtml = '<img src="' + esc(photo) + '" alt="">'; box.innerHTML = picHtml; return; }
        // gdrive: -- the roster's resolver writes the <img>; keep it for the next render.
        R().photoInto(photo, picId);
        var tries = 0, t = setInterval(function () {
          var b = document.getElementById(picId), img = b && b.querySelector('img');
          if (img) { picHtml = b.innerHTML; clearInterval(t); } else if (++tries > 40) clearInterval(t);
        }, 250);
      }
      host.innerHTML = '';
      window.dgAgentPaper.mount(host, {
        code: code, char: R().doc(code), name: a.name, codename: brief.codename || '', brief: brief,
        photo: photo,
        // The photo in the paper's head, the way Agent Hub shows it: an
        // https link as it is, a legacy gdrive: one through the roster's proxy.
        photoHtml: photo ? '<div class="ac-paperpic" id="' + picId + '"></div>' : '',
        onPhoto: function () { fillPic(); },
        loadPhoto: function (box, src) { if (/^(https?:|data:)/.test(src)) box.innerHTML = '<img src="' + esc(src) + '" alt="">'; },
        professionLabel: profTitle, members: [], cellName: c ? (c.name || c.cell_id) : '', handlerView: !opts.asPlayer,
        confirmSave: reason
      });
      var ed = host.querySelector('[data-a="edit"]');
      if (ed && !opts.view) ed.click();
    }).catch(function (err) {
      w.querySelector('.ac-paperhost').innerHTML = '<div class="ac-none">Could not open the Agent File: ' + esc((err && err.message) || err) + '</div>';
    });
    return w;
  }

  window.dgAcPlayers = { ensureFile: ensureFile, append: append, editSheet: editSheet, stamp: stamp, tellPlayer: tellPlayer, SECTIONS: SECTIONS,
    candidates: candidates, linkFile: linkFile, mergeInto: mergeInto };
})();
