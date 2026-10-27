/* A-Cell's sound control center (v3.12.0), the Music tab's player: the
   broadcast on a tape deck. Everything the classic broadcast desk does,
   on the same engine (window.dgAcellMusic):

     the deck   channel 1–5, the Cell's own channel (and setting it), on
                air, what's playing, seek, ◀◀ ▶/❚❚ ■ LOOP, a link to play
                or cue (YouTube, SoundCloud, an .mp3)
     the mixer  track and ambience levels for everyone on the channel
     on air     every loop and effect sounding now: pause, loop, stop,
                and STOP ALL
     the tape   the session's tracks and pads, one tap to play or fire
     cue list   what plays next, auto-advance

   The tape shelf (assets/acell-library.js) sits under it. */
(function () {
  'use strict';
  var A = window.dgAc;
  var root = document.getElementById('ac-console');
  if (!A || !root || window.dgAcConsole) return;
  var esc = A.esc;
  function M() { return window.dgAcellMusic; }
  var st = { open: false, seeking: false, cell: '', link: { url: '', title: '', loop: false }, tick: null };

  function fmt(sec) { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
  function curCell() {
    var s = A.session();
    var id = st.cell || (s && s.cell_id) || '';
    return A.cell(id);
  }

  function build() {
    root.innerHTML =
      '<div class="cc">' +
      '<section class="cc-deck">' +
        '<div class="cc-top"><span class="cc-chs" data-cc="chs"></span><span class="cc-air" data-cc="air"></span>' +
        '<span class="cc-cell"><select data-cc="cell" aria-label="Cell"></select><button type="button" class="cc-mini" data-cc="assign"></button></span></div>' +
        '<div class="cc-scr" data-cc="scr"></div>' +
        '<div class="cc-reels" data-cc="reels"><i></i><span class="cc-tape"></span><i></i></div>' +
        '<div class="cc-seek" data-cc="seekrow"><span data-cc="el">0:00</span><input type="range" min="0" max="0" step="1" value="0" data-cc="seek" aria-label="Seek"><span data-cc="du">0:00</span></div>' +
        '<div class="cc-keys"><button type="button" data-cc="restart" title="From the top">◀◀</button><button type="button" data-cc="pause" title="Play / pause">▶ ❚❚</button>' +
        '<button type="button" data-cc="stop" title="Stop the track">■</button><button type="button" data-cc="loop" title="Loop the track">LOOP</button></div>' +
        '<form class="cc-link" data-cc="linkform"><input type="url" placeholder="A link: YouTube, SoundCloud or .mp3" data-cc="url" required>' +
        '<input placeholder="Title" data-cc="title"><label class="cc-ck"><input type="checkbox" data-cc="linkloop"> loop</label>' +
        '<button type="submit" class="cc-mini p">▶ Play</button><button type="button" class="cc-mini" data-cc="cue">+ Cue</button></form>' +
        '<div class="cc-status" data-cc="status"></div>' +
      '</section>' +
      '<section class="cc-side">' +
        '<div class="cc-panel"><div class="cc-h">Mixer · everyone on CH <b data-cc="mixch"></b></div>' +
          '<label class="cc-fader">Track<input type="range" min="0" max="100" data-cc="mix-track"><b data-cc="mix-track-v"></b></label>' +
          '<label class="cc-fader">Ambience<input type="range" min="0" max="100" data-cc="mix-ambient"><b data-cc="mix-ambient-v"></b></label></div>' +
        '<div class="cc-panel"><div class="cc-h">On air now<button type="button" class="cc-stopall" data-cc="stopall">STOP ALL</button></div><div data-cc="live"></div></div>' +
        '<div class="cc-panel"><div class="cc-h">Session tape<span data-cc="sname"></span></div><div data-cc="tape"></div></div>' +
        '<div class="cc-panel"><div class="cc-h">Cue list<label class="cc-ck"><input type="checkbox" data-cc="auto"> auto-advance</label></div><div data-cc="cues"></div></div>' +
      '</section></div>';
  }
  function q(k) { return root.querySelector('[data-cc="' + k + '"]'); }

  function draw() {
    var m = M();
    if (!m) return;
    if (!root.firstChild) build();
    var s = A.session(), now = m.state(), cur = now.current || {}, ch = m.channel();
    // Channels and the Cell
    q('chs').innerHTML = 'CH ' + m.channels().map(function (c) { return '<button type="button" class="cc-ch' + (c === ch ? ' on' : '') + '" data-ch="' + c + '">' + c + '</button>'; }).join('');
    var playing = !!cur.track_url && !cur.paused;
    q('air').className = 'cc-air' + (playing ? ' on' : '');
    q('air').textContent = playing ? '● ON AIR' : cur.track_url ? '❚❚ PAUSED' : 'OFF AIR';
    var c = curCell(), sel = q('cell');
    if (document.activeElement !== sel) {
      sel.innerHTML = '<option value="">Cell…</option>' + A.cells().map(function (x) {
        return '<option value="' + esc(x.cell_id) + '"' + (c && c.cell_id === x.cell_id ? ' selected' : '') + '>' + esc(x.name || x.cell_id) + (x.channel ? ' · CH ' + esc(x.channel) : '') + '</option>';
      }).join('');
    }
    var as = q('assign');
    as.hidden = !c || String(c.channel) === String(ch);
    if (c) as.textContent = 'Make CH ' + ch + ' ' + (c.name || 'its') + '\'s channel';
    // The screen and the reels
    var lines = [];
    lines.push(cur.track_url ? (cur.paused ? '❚❚ ' : '▶ ') + esc((cur.track_title || cur.track_url).toUpperCase()) + (cur.loop ? ' <i>LOOP</i>' : '') : '— NO TRACK —');
    (now.ambient || []).forEach(function (x) { lines.push('≈ ' + esc(m.label('ambient', x.id).toUpperCase()) + (x.paused ? ' ❚❚' : '')); });
    q('scr').innerHTML = '<span class="cc-chr">CH ' + esc(ch) + '</span>' + lines.join('<br>');
    q('reels').className = 'cc-reels' + (playing ? ' spin' : '');
    drawSeek();
    q('loop').classList.toggle('on', !!cur.loop);
    q('status').textContent = m.status();
    // Mixer
    var mix = m.mix();
    q('mixch').textContent = ch;
    ['track', 'ambient'].forEach(function (k) {
      var sl = q('mix-' + k);
      if (document.activeElement !== sl) sl.value = mix[k];
      q('mix-' + k + '-v').textContent = sl.value;
    });
    // On air now
    var live = (now.ambient || []).map(function (x) {
      return '<div class="cc-row" data-kind="ambient" data-ref="' + esc(x.id) + '"><span class="cc-k">LOOP</span><span class="cc-t">' + esc(m.label('ambient', x.id)) + '</span>' +
        '<button type="button" class="cc-mini" data-cc="s-pause">' + (x.paused ? '▶' : '❚❚') + '</button>' +
        '<button type="button" class="cc-mini' + (x.loop === false ? '' : ' on') + '" data-cc="s-loop" title="Loop">⟲</button>' +
        '<button type="button" class="cc-mini" data-cc="s-stop" title="Stop">✕</button></div>';
    }).concat((now.stingers || []).filter(function (x) { return !x.stopped; }).map(function (x) {
      return '<div class="cc-row" data-kind="stinger" data-ref="' + esc(x.fired_at) + '"><span class="cc-k fx">SFX</span><span class="cc-t">' + esc(m.label('stinger', x.id)) + ' <small>' + fmt(m.elapsedOf(x)) + '</small></span>' +
        '<button type="button" class="cc-mini" data-cc="s-pause">' + (x.paused ? '▶' : '❚❚') + '</button>' +
        '<button type="button" class="cc-mini' + (x.loop ? ' on' : '') + '" data-cc="s-loop" title="Loop">⟲</button>' +
        '<button type="button" class="cc-mini" data-cc="s-stop" title="Stop">✕</button></div>';
    }));
    q('live').innerHTML = live.join('') || '<div class="cc-none">Silence. Loops and effects you start show here.</div>';
    // The session's tape
    q('sname').textContent = s ? s.name : '';
    q('tape').innerHTML = s ? ((s.tracks.length ? '<div class="cc-tts">' + s.tracks.map(function (t, i) {
      var on = t.kind === 'ambient' ? (now.ambient || []).some(function (x) { return x.id === t.ref; }) : (!!cur.track_url && cur.track_title === t.title);
      return '<button type="button" class="cc-tt' + (on ? ' on' : '') + '" data-cc="tape" data-i="' + i + '">' + (t.kind === 'ambient' ? '≈ ' : '♪ ') + esc(t.title) + '</button>';
    }).join('') + '</div>' : '') + (s.pads.length ? '<div class="cc-pads">' + s.pads.map(function (id) {
      return '<button type="button" class="cc-pad" data-cc="pad" data-id="' + esc(id) + '">' + esc(m.label('stinger', id)) + '</button>';
    }).join('') + '</div>' : '') || '<div class="cc-none">Nothing on the session\'s tape yet — pick from the shelf below.</div>')
      : '<div class="cc-none">Choose a session (top bar) to have its tape here.</div>';
    // Cue list
    var cues = m.cueList();
    q('cues').innerHTML = cues.length ? cues.map(function (t, i) {
      return '<div class="cc-row" data-i="' + i + '"><span class="cc-k">' + (i + 1) + '</span><span class="cc-t">' + esc(t.title || t.url) + '</span>' +
        '<button type="button" class="cc-mini" data-cc="cue-play">▶</button><button type="button" class="cc-mini" data-cc="cue-rm">✕</button></div>';
    }).join('') : '<div class="cc-none">Empty. "+ Cue" a link above, or a track from the shelf.</div>';
    q('auto').checked = !!m.autoAdvance();
  }
  function drawSeek() {
    var m = M(), cur = (m.state().current || {}), du = m.duration(), sl = q('seek');
    q('seekrow').hidden = !cur.track_url;
    if (st.seeking) return;
    var el = m.elapsed();
    sl.max = Math.max(du, el, 1);
    sl.value = el;
    q('el').textContent = fmt(el);
    q('du').textContent = du ? fmt(du) : '—:—';
  }

  root.addEventListener('click', function (e) {
    var m = M(), s = A.session();
    var chb = e.target.closest('[data-ch]');
    if (chb) { m.setChannel(chb.getAttribute('data-ch')); return; }
    var b = e.target.closest('[data-cc]');
    if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT' || b.tagName === 'FORM') return;
    var row = b.closest('[data-kind]'), irow = b.closest('[data-i]');
    switch (b.getAttribute('data-cc')) {
      case 'restart': m.restart(); return;
      case 'pause': m.togglePause(); return;
      case 'stop': m.stop(); return;
      case 'loop': m.toggleLoop(); return;
      case 'stopall': m.stopAll(); return;
      case 'assign': { var c = curCell(); if (c) m.assignCell(c.cell_id).then(draw); return; }
      case 'cue': {
        var url = q('url').value.trim();
        if (!url) { q('url').focus(); return; }
        m.cue({ url: url, title: q('title').value.trim() });
        q('url').value = ''; q('title').value = '';
        return;
      }
      case 'cue-play': m.playCue(+irow.getAttribute('data-i')); return;
      case 'cue-rm': m.uncue(+irow.getAttribute('data-i')); return;
      case 'tape': {
        var t = s.tracks[+b.getAttribute('data-i')];
        if (t.kind === 'ambient') m.setAmbient(t.ref, !(m.state().ambient || []).some(function (x) { return x.id === t.ref; }));
        else { var tk = A.trackById(t.ref), u = tk ? tk.url : t.ref; if (u) m.play({ url: u, title: t.title, kind: 'audio', loop: false }); }
        return;
      }
      case 'pad': b.classList.add('hit'); setTimeout(function () { b.classList.remove('hit'); }, 250); m.fire(b.getAttribute('data-id')); return;
      case 's-pause': case 's-loop': case 's-stop': {
        var kind = row.getAttribute('data-kind'), ref = row.getAttribute('data-ref');
        var inst = (kind === 'ambient' ? m.state().ambient : m.state().stingers).filter(function (x) { return String(kind === 'ambient' ? x.id : x.fired_at) === ref; })[0];
        if (!inst) return;
        var refId = kind === 'ambient' ? ref : inst.fired_at;
        var a = b.getAttribute('data-cc');
        if (a === 's-stop') m.sound(kind, refId, kind === 'ambient' ? 'set_ambient_layer' : 'stop_stinger');
        else if (a === 's-pause') m.sound(kind, refId, (inst.paused ? 'resume_' : 'pause_') + (kind === 'ambient' ? 'ambient_layer' : 'stinger'));
        else m.sound(kind, refId, kind === 'ambient' ? 'set_ambient_layer_loop' : 'set_stinger_loop', { loop: (kind === 'ambient' ? inst.loop === false : !inst.loop) ? '1' : '0' });
        return;
      }
    }
  });
  root.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = q('url').value.trim();
    if (url) { M().playLink(url, q('title').value.trim(), q('linkloop').checked); q('url').value = ''; q('title').value = ''; }
  });
  root.addEventListener('input', function (e) {
    var k = e.target.getAttribute('data-cc');
    if (k === 'seek') { st.seeking = true; q('el').textContent = fmt(e.target.value); }
    else if (k === 'mix-track' || k === 'mix-ambient') { q(k + '-v').textContent = e.target.value; M().setMix(k.slice(4), e.target.value); }
  });
  root.addEventListener('change', function (e) {
    var k = e.target.getAttribute('data-cc'), m = M();
    if (k === 'seek') { st.seeking = false; m.seek(Number(e.target.value)); }
    else if (k === 'auto') m.autoAdvance(e.target.checked);
    else if (k === 'cell') {
      st.cell = e.target.value;
      var c = A.cell(st.cell);
      if (c && c.channel) m.setChannel(String(c.channel));
      draw();
    }
  });

  var t0 = null;
  function soon() { if (!st.open) return; clearTimeout(t0); t0 = setTimeout(draw, 30); }
  document.addEventListener('dg-acell-tab', function (e) {
    st.open = e.detail.tab === 'music';
    clearInterval(st.tick);
    if (!st.open) return;
    // The session's Cell's channel, the first time the tab opens for it.
    var s = A.session(), c = s && A.cell(s.cell_id);
    if (c && c.channel && !st.tuned && M()) { st.tuned = true; M().setChannel(String(c.channel)); }
    draw();
    st.tick = setInterval(function () { if (root.firstChild) drawSeek(); }, 1000);
  });
  ['dg-acell-music', 'dg-sessions', 'dg-acell-roster'].forEach(function (ev) { document.addEventListener(ev, soon); });

  // The classic desk, folded or not, as this device left it.
  var classic = document.getElementById('ac-classic');
  if (classic) {
    try { classic.open = localStorage.getItem('dg_acell_classic_open') === '1'; } catch (e) { /* folded */ }
    classic.addEventListener('toggle', function () { try { localStorage.setItem('dg_acell_classic_open', classic.open ? '1' : '0'); } catch (e) { /* this time only */ } });
  }

  window.dgAcConsole = { draw: draw };
})();
