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
    var path = A.playerPath(a.name);
    return V().load().catch(function () {}).then(function () {
      return V().get(path) ? path : V().save(path, template(a));
    });
  }
  // Adds lines ("- …") at the end of a ## section, making it if it's missing.
  function append(path, section, lines) {
    if (!lines || !lines.length) return Promise.resolve(path);
    var md = (V().get(path) || {}).content || '';
    var all = md.replace(/\s+$/, '').split('\n'), r = V().sectionRange(md, section);
    if (!r) {
      all = all.concat(['', '## ' + section, ''], lines);
    } else {
      var end = r.to;
      while (end > r.from + 1 && !all[end - 1].trim()) end--;
      all = all.slice(0, end).concat(lines, all.slice(end).length ? [''] : [], all.slice(end));
    }
    return V().save(path, all.join('\n').replace(/\n{3,}/g, '\n\n') + '\n');
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

  function show(code) {
    var a = A.agent(code) || { code: code, name: code };
    var path = A.playerPath(a.name);
    if (cur.code !== code || cur.path !== path) {
      if (cur.ed) { cur.ed.destroy(); cur.ed = null; }
      cur.code = code; cur.path = path;
      side.innerHTML = '<div class="ac-pf-hd"><span class="ac-t">' + esc(a.name) + '<small>player file</small></span>' +
        '<button type="button" class="ac-btn p" data-pf="edit">✎ Edit sheet</button></div><div class="ac-pf-body"><div class="ac-none">Loading…</div></div>';
    }
    V().load().then(function () { drawBody(); }, function (err) {
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
    if (a === 'start') ensureFile(cur.code).then(drawBody);
    else if (a === 'edit') editSheet(cur.code);
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
        '<div class="vn-new" style="justify-content:flex-end"><button type="button" class="vn-btn" data-no>Back to editing</button><button type="button" class="vn-btn p" data-yes>Save</button></div>', 'ac-ask ac-reason');
      setTimeout(function () { w.querySelector('.ac-why').focus(); }, 0);
      var done = false;
      function finish(ok) {
        if (done) return; done = true;
        var why = w.querySelector('.ac-why').value.trim();
        w.remove();
        res(ok);
        if (!ok) return;
        var line = '- ' + stamp(A.session()) + ' · by Handler: ' + (who.changes.length ? who.changes.join(', ') : 'sheet edited') + (why ? ' — ' + why : '');
        ensureFile(who.code).then(function (path) { return append(path, 'Sheet changes', [line]); }).catch(function (err) { console.error('a-cell: could not log the sheet change', err); });
      }
      w.addEventListener('click', function (e) {
        if (e.target.closest('[data-yes]')) finish(true);
        else if (e.target.closest('[data-no]') || e.target.closest('[data-vclose]') || e.target === w) finish(false);
      });
    });
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
      host.innerHTML = '';
      window.dgAgentPaper.mount(host, {
        code: code, char: R().doc(code), name: a.name, codename: brief.codename || '', brief: brief,
        photo: window.dgMainPhoto ? window.dgMainPhoto(brief) : (brief.face_plate_url || ''),
        professionLabel: profTitle, members: [], cellName: c ? (c.name || c.cell_id) : '',
        confirmSave: reason
      });
      var ed = host.querySelector('[data-a="edit"]');
      if (ed && !opts.view) ed.click();
    }).catch(function (err) {
      w.querySelector('.ac-paperhost').innerHTML = '<div class="ac-none">Could not open the Agent File: ' + esc((err && err.message) || err) + '</div>';
    });
    return w;
  }

  window.dgAcPlayers = { ensureFile: ensureFile, append: append, editSheet: editSheet, stamp: stamp, SECTIONS: SECTIONS };
})();
