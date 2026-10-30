/* A-Cell's sound control center (v3.12.0), the Music tab's player: the
   broadcast on a tape deck. Everything the classic broadcast desk does,
   on the same engine (window.dgAcellMusic):

     the deck   channel 1–5, the Cell's own channel (and setting it), on
                air, what's playing and the tape's tracks (tap to play),
                seek, ◀◀ ▶/❚❚ ■ LOOP; links go on a tape (the tape editor)
     the mixer  music, loops and effects levels for everyone on the channel
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
  var st = { open: false, seeking: false, cell: '', link: { url: '', title: '' }, tick: null };

  function fmt(sec) { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
  function curCell() {
    var s = A.session();
    var id = st.cell || (s && s.cell_id) || '';
    return A.cell(id);
  }

  // An icon from A-Cell's set (assets/acell-icons.js), or the old glyph.
  function ic(n, alt) { return window.dgIcons ? window.dgIcons.svg(n, 's') : alt; }
  function build() {
    root.innerHTML =
      '<div class="cc">' +
      '<section class="cc-deck">' +
        '<div class="cc-top"><span class="cc-chs" data-cc="chs"></span><span class="cc-air" data-cc="air"></span><button type="button" class="cc-hear" data-cc="hear" aria-pressed="false" title="Play on this device" aria-label="Play on this device"></button>' +
        '<span class="cc-cell"><select data-cc="cell" aria-label="Cell"></select><button type="button" class="cc-mini" data-cc="assign"></button></span></div>' +
        '<div class="cc-scr" data-cc="scr"></div>' +
        '<div class="cc-reels" data-cc="reels"><i></i><span class="cc-tape"></span><i></i></div>' +
        '<div class="cc-seek" data-cc="seekrow"><span data-cc="el">0:00</span><input type="range" min="0" max="0" step="1" value="0" data-cc="seek" aria-label="Seek"><span data-cc="du">0:00</span></div>' +
        '<div class="cc-keys"><button type="button" data-cc="restart" title="From the top" aria-label="From the top">' + ic('prev', '◀◀') + '</button><button type="button" data-cc="pause" title="Play / pause" aria-label="Play or pause">' + ic('play', '▶') + ic('pause', '❚❚') + '</button>' +
        '<button type="button" data-cc="stop" title="Stop the track" aria-label="Stop">' + ic('stop', '■') + '</button><button type="button" data-cc="loop" title="Loop the track" aria-label="Loop">' + ic('loop', '') + 'LOOP</button></div>' +
        // Links go on a tape now (the open tape's + a link), not in here (2026-10-30).
        '<div class="cc-status" data-cc="status"></div>' +
      '</section>' +
      '<section class="cc-side">' +
        '<div class="cc-panel"><div class="cc-h">Mixer · everyone on CH <b data-cc="mixch"></b></div>' +
          '<label class="cc-fader">Music<input type="range" min="0" max="100" data-cc="mix-track"><b data-cc="mix-track-v"></b></label>' +
          '<label class="cc-fader">Loops<input type="range" min="0" max="100" data-cc="mix-ambient"><b data-cc="mix-ambient-v"></b></label>' +
          '<label class="cc-fader">Effects<input type="range" min="0" max="100" data-cc="mix-effects"><b data-cc="mix-effects-v"></b></label></div>' +
        '<div class="cc-panel"><div class="cc-h">On air now<button type="button" class="cc-stopall" data-cc="stopall">STOP ALL</button></div><div data-cc="live"></div></div>' +
        '<div class="cc-panel"><div class="cc-h">Tape in the deck<span data-cc="sname"></span></div><div data-cc="tape"></div></div>' +
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
    q('chs').innerHTML = '<span class="cc-chl">CH </span>' + m.channels().map(function (c) { return '<button type="button" class="cc-ch' + (c === ch ? ' on' : '') + '" data-ch="' + c + '">' + c + '</button>'; }).join('');
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
    // The whole cue list on the screen (2026-10-30): tap a track to play it.
    var cl = m.cueList(), at = -1;
    if (cur.track_url) cl.forEach(function (t, i) { if (at < 0 && t.url === cur.track_url) at = i; });
    var list = cl.length ? '<div class="cc-scr-list">' + cl.map(function (t, i) {
      return '<button type="button" class="cc-scr-t' + (i === at ? ' on' : '') + '" data-cc="cue-play" data-i="' + i + '"><b>' + (i === at ? (cur.paused ? '❚❚' : '▶') : String(i + 1)) + '</b>' + esc(String(t.title || t.url).toUpperCase()) + '</button>';
    }).join('') + '</div>' : '';
    q('scr').innerHTML = '<span class="cc-chr">CH ' + esc(ch) + '</span>' + lines.join('<br>') + list;
    q('reels').className = 'cc-reels' + (playing ? ' spin' : '');
    drawSeek();
    q('loop').classList.toggle('on', !!cur.loop);
    follow(); drawHear();
    q('status').textContent = m.status();
    // Mixer
    var mix = m.mix();
    q('mixch').textContent = ch;
    ['track', 'ambient', 'effects'].forEach(function (k) {
      var sl = q('mix-' + k);
      if (document.activeElement !== sl) sl.value = mix[k];
      q('mix-' + k + '-v').textContent = sl.value;
    });
    // On air now
    var live = (now.ambient || []).map(function (x) {
      return '<div class="cc-row" data-kind="ambient" data-ref="' + esc(x.id) + '"><span class="cc-k">LOOP</span><span class="cc-t">' + esc(m.label('ambient', x.id)) + '</span>' +
        '<button type="button" class="cc-mini" data-cc="s-pause" aria-label="Pause">' + (x.paused ? ic('play', '▶') : ic('pause', '❚❚')) + '</button>' +
        '<button type="button" class="cc-mini' + (x.loop === false ? '' : ' on') + '" data-cc="s-loop" title="Loop" aria-label="Loop">' + ic('loop', 'loop') + '</button>' +
        '<button type="button" class="cc-mini" data-cc="s-stop" title="Stop" aria-label="Stop">' + ic('close', '✕') + '</button></div>';
    }).concat((now.stingers || []).filter(function (x) { return !x.stopped; }).map(function (x) {
      return '<div class="cc-row" data-kind="stinger" data-ref="' + esc(x.fired_at) + '"><span class="cc-k fx">SFX</span><span class="cc-t">' + esc(m.label('stinger', x.id)) + ' <small>' + fmt(m.elapsedOf(x)) + '</small></span>' +
        '<button type="button" class="cc-mini" data-cc="s-pause" aria-label="Pause">' + (x.paused ? ic('play', '▶') : ic('pause', '❚❚')) + '</button>' +
        '<button type="button" class="cc-mini' + (x.loop ? ' on' : '') + '" data-cc="s-loop" title="Loop" aria-label="Loop">' + ic('loop', 'loop') + '</button>' +
        '<button type="button" class="cc-mini" data-cc="s-stop" title="Stop" aria-label="Stop">' + ic('close', '✕') + '</button></div>';
    }));
    q('live').innerHTML = live.join('') || '<div class="cc-none">Silence. Loops and effects you start show here.</div>';
    // The tape in the deck (assets/acell-tapes.js): its tracks, its pads; else the ones to put in.
    var D = window.dgTapes, deck = D && D.inDeck();
    var dt = deck && deck.tracks ? deck : null;
    q('sname').innerHTML = deck ? '<button type="button" class="cc-mini" data-cc="eject">' + ic('eject', '') + 'Take tape out</button>' : '';
    if (dt) {
      q('tape').innerHTML = '<div class="cc-deckcas">' + D.cassette(dt, { size: 'sm', spin: playing }) + '</div>' +
        '<div class="cc-tts">' + dt.tracks.map(function (t, i) {
          var on = !!cur.track_url && cur.track_title === t.title;
          return '<button type="button" class="cc-tt' + (on ? ' on' : '') + '" data-cc="tape" data-i="' + i + '">' + (i + 1) + ' · ' + esc(t.title) + '<small>' + esc(D.fmt(t.dur)) + '</small></button>';
        }).join('') + '</div>' +
        (dt.pads.length ? '<div class="cc-pads">' + dt.pads.map(function (id) {
          return '<button type="button" class="cc-pad" data-cc="pad" data-id="' + esc(id) + '">' + esc(m.label('stinger', id)) + '</button>';
        }).join('') + '</div>' : '');
    } else {
      var choices = D ? D.forOperation(s && s.operation_id).concat(D.forCell(s && s.cell_id)) : [];
      q('tape').innerHTML = choices.length ? '<div class="cc-none">Nothing in the deck. Put a tape in:</div><div class="cc-tts">' + choices.map(function (t) {
        return '<button type="button" class="cc-tt" data-cc="insert" data-id="' + esc(t.id) + '">▶ ' + esc(t.name) + '<small>' + esc(D.fmt(D.runtime(t))) + '</small></button>';
      }).join('') + '</div>' : '<div class="cc-none">No tape in the deck. Make one under Tapes, above.</div>';
    }
    // Cue list
    var cues = m.cueList();
    q('cues').innerHTML = cues.length ? cues.map(function (t, i) {
      return '<div class="cc-row" data-i="' + i + '"><span class="cc-k">' + (i + 1) + '</span><span class="cc-t">' + esc(t.title || t.url) + '</span>' +
        '<button type="button" class="cc-mini" data-cc="cue-play">▶</button><button type="button" class="cc-mini" data-cc="cue-rm">✕</button></div>';
    }).join('') : '<div class="cc-none">Empty. "+ Cue" a link above, or a track from the shelf.</div>';
    q('auto').checked = !!m.autoAdvance();
  }
  // A track's length, first from what the tape and the library know: a
  // phone never loads the audio, and the engine's fallback was a 30:00
  // placeholder (2026-10-30: the bar sat at 0:00 / 30:00 on a phone).
  function knownDur(cur) {
    var D = window.dgTapes, t = D && D.inDeck(), m = M(), d = 0;
    if (t && t.tracks) t.tracks.forEach(function (x) { if (!d && x.title === cur.track_title && +x.dur) d = +x.dur; });
    if (!d && m && m.tracks) (m.tracks() || []).forEach(function (x) { if (!d && x.url === cur.track_url && +x.duration) d = +x.duration; });
    return d;
  }
  function drawSeek() {
    var m = M(), cur = (m.state().current || {}), du = knownDur(cur) || m.duration(), sl = q('seek');
    q('seekrow').hidden = !cur.track_url;
    if (st.seeking) return;
    // A looping track goes round: the position within this time through.
    var el = m.elapsed();
    if (du > 0) el = cur.loop ? el % du : Math.min(el, du);
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
      case 'hear': hear(!st.hear); return;
      case 'restart': m.restart(); return;
      case 'pause': m.togglePause(); return;
      case 'stop': m.stop(); return;
      case 'loop': m.toggleLoop(); return;
      case 'stopall': m.stopAll(); return;
      case 'assign': { var c = curCell(); if (c) m.assignCell(c.cell_id).then(draw); return; }
      case 'cue-play': m.playCue(+(b.getAttribute('data-i') || irow.getAttribute('data-i'))); return;
      case 'cue-rm': m.uncue(+irow.getAttribute('data-i')); return;
      case 'tape': m.playCue(+b.getAttribute('data-i')); return;
      case 'insert': window.dgTapes.insert(b.getAttribute('data-id')); return;
      case 'eject': window.dgTapes.eject(); return;
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
  root.addEventListener('input', function (e) {
    var k = e.target.getAttribute('data-cc');
    if (k === 'seek') { st.seeking = true; q('el').textContent = fmt(e.target.value); }
    else if (k === 'mix-track' || k === 'mix-ambient' || k === 'mix-effects') { q(k + '-v').textContent = e.target.value; M().setMix(k.slice(4), e.target.value); }
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

  /* Hear it here (2026-10-30): the Hub's own radio (the one Tune In
     opens, in the page around A-Cell) tuned to this player's channel and
     unmuted, so this device plays it all: track, loops and effects. Its
     tap is what lets iOS start the sound. A-Cell on its own page has no
     radio: then this device's preview plays the track. */
  function R() { try { if (window.dgRadio) return window.dgRadio; if (window.parent !== window && window.parent.dgRadio) return window.parent.dgRadio; } catch (e) { /* not ours */ } return null; }
  try { st.hear = localStorage.getItem('dg_acell_hear') === '1'; } catch (e) { st.hear = false; }
  function hear(on) {
    st.hear = !!on;
    try { localStorage.setItem('dg_acell_hear', on ? '1' : '0'); } catch (e) { /* this time only */ }
    var r = R(), m = M();
    if (r) {
      if (on) { r.tune(m.channel()); r.setMuted(false); if (r.resume) try { r.resume(); } catch (e) { /* the next tap */ } }
      else r.setMuted(true);
    } else if (m && m.previewHear) m.previewHear(on);
    drawHear();
  }
  function drawHear() {
    var b = q('hear');
    if (!b) return;
    var r = R(), s = r && r.state ? r.state() : null, m = M();
    var on = st.hear && (!r || (s && s.channel === m.channel() && !s.muted));
    b.classList.toggle('on', !!on);
    b.setAttribute('aria-pressed', String(!!on));
    // One speaker button: struck through off, sounding in gold on (2026-10-30);
    // iOS still waiting for a tap shows it pulsing.
    var wait = !!(on && s && s.resumeNeeded);
    b.classList.toggle('wait', wait);
    b.innerHTML = window.dgIcons ? window.dgIcons.svg(on ? 'speaker' : 'speaker-off') : '';
    b.title = on ? (wait ? 'Tap to start the sound on this device' : 'Playing on this device: tap to stop') : 'Play on this device';
  }
  // The channel changed while hearing: the radio follows it.
  function follow() {
    var r = R(), m = M();
    if (!st.hear || !r || !m) return;
    var s = r.state();
    if (s.channel !== m.channel()) r.tune(m.channel());
  }
  var t0 = null, onTab = false, home = null;
  function soon() { if (!st.open) return; clearTimeout(t0); t0 = setTimeout(draw, 30); }
  function live(on) {
    st.open = on;
    clearInterval(st.tick);
    if (!on) return;
    draw();
    st.tick = setInterval(function () { if (root.firstChild) drawSeek(); }, 1000);
  }
  // Lent to another screen (the phone's Pads, 2026-10-30): the player moves
  // there, live, and back to the Music tab after.
  // how: 'phone' (the deck only) or 'desk' (the deck, mixer and on air).
  function attach(host, how) {
    if (!host) return;
    if (!home) { home = document.createComment('ac-console'); root.parentNode.insertBefore(home, root); }
    if (root.parentNode !== host) host.appendChild(root);
    root.classList.remove('cc-phone', 'cc-desk');
    root.classList.add('cc-lent', 'cc-' + (how || 'phone'));
    live(true);
  }
  function detach() {
    if (!home || !home.parentNode) return;
    home.parentNode.insertBefore(root, home);
    home.parentNode.removeChild(home); home = null;
    root.classList.remove('cc-lent', 'cc-phone', 'cc-desk');
    live(onTab);
  }
  document.addEventListener('dg-acell-tab', function (e) {
    onTab = e.detail.tab === 'music';
    if (home) return;
    st.open = onTab;
    clearInterval(st.tick);
    if (!st.open) return;
    // The session's Cell's channel, the first time the tab opens for it.
    var s = A.session(), c = s && A.cell(s.cell_id);
    if (c && c.channel && !st.tuned && M()) { st.tuned = true; M().setChannel(String(c.channel)); }
    draw();
    st.tick = setInterval(function () { if (root.firstChild) drawSeek(); }, 1000);
  });
  ['dg-acell-music', 'dg-sessions', 'dg-acell-roster', 'dg-tapes'].forEach(function (ev) { document.addEventListener(ev, soon); });

  // The classic desk, folded or not, as this device left it.
  var classic = document.getElementById('ac-classic');
  if (classic) {
    try { classic.open = localStorage.getItem('dg_acell_classic_open') === '1'; } catch (e) { /* folded */ }
    classic.addEventListener('toggle', function () { try { localStorage.setItem('dg_acell_classic_open', classic.open ? '1' : '0'); } catch (e) { /* this time only */ } });
  }

  window.dgAcConsole = { draw: draw, attach: attach, detach: detach, lent: function () { return !!home; } };
})();
