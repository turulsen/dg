/* ══════════════════════════════════════════════
   TABLE RADIO -- a small persistent widget, included on every player-
   reachable Hub page, that keeps a player "tuned in" to a Handler's
   music channel as they move around the Hub. A static multi-page site
   can't keep one <audio>/<iframe> alive across a real page navigation
   -- each page load is a fresh document -- so this widget re-embeds
   and seeks to the Handler's current track on every page it lands on,
   using the same server-stamped started_at timestamp every device
   reads, so it resumes in roughly the right spot rather than from
   zero. That's "loosely synced", not gapless: expect a beat of
   silence during the navigation itself, same tradeoff already used
   for Cloud Save's eventually-consistent character sync. Landing in
   the Minimized state by default (see EXPANDED_KEY below) keeps that
   beat as unobtrusive as it can be -- a slim bar reappearing reads a
   lot less jarring than the full dial+video panel flashing in on
   every single page load.

   Requires the set_now_playing / get_now_playing Apps Script actions
   (see acell-table-radio-addition.txt, handed over separately -- not
   yet deployed on the live backend until pasted in and redeployed).

   Deliberately styled as its own self-contained floating "device"
   (dark, amber/green field-radio look) rather than trying to match
   each page's own theme -- this page loads on the dark folder-look
   Hub pages AND stats/index.html's six very different themes, and a
   fixed prop identity reads better everywhere than chasing six
   palettes.

   Minimized vs Expanded: the video/audio embed is never removed from
   the DOM when minimizing (that would pause it) -- only its wrapper's
   height collapses to 0 with overflow:hidden, which keeps the iframe
   technically rendered (just visually clipped to nothing) so YouTube/
   SoundCloud keep playing in the background. Expanded gives a real,
   usable video area (220px, not the old cramped 70px) for actually
   interacting with YouTube's own scrubber/fullscreen/etc.

   Volume: a real 0-100 slider, not just mute. Direct <audio> uses its
   native .volume. YouTube's plain embed URL has no volume param at
   all, so a YouTube track is driven through the YouTube IFrame Player
   API (loaded on demand) instead of a raw <iframe src=...>, exposing
   setVolume()/mute()/unMute(). SoundCloud gets the same treatment via
   its own Widget API. The one generic-iframe fallback (an arbitrary
   embeddable URL that's neither) has never been controllable this way
   -- no API, cross-origin -- so its volume slider is hidden rather
   than shown non-functional.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";
  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';
  var CHANNEL_KEY = 'dg_radio_channel';
  var MUTED_KEY = 'dg_radio_muted';
  var VOLUME_KEY = 'dg_radio_volume';
  var EXPANDED_KEY = 'dg_radio_expanded';
  var POLL_MS = 6000;
  // Fixed numbered channels, picked by turning a dial rather than typing a
  // name -- five slots, no typos, no two players landing on "sam" vs "Sam".
  var CHANNELS = ['1', '2', '3', '4', '5'];

  var lastStartedAt = null;
  var pollTimer = null;

  // Which live-controllable player (if any) currently backs the embed --
  // drives whether a mute/volume change can be applied in place (cheap,
  // no reload) or needs a full renderEmbed() rebuild.
  var currentEmbedKind = null; // 'yt' | 'sc' | 'audio' | 'generic' | null
  var ytPlayer = null;
  var scWidget = null;
  var ytApiLoading = false;
  var ytApiCallbacks = [];
  var scApiLoading = false;
  var scApiCallbacks = [];

  function channelIndex(ch) {
    var i = CHANNELS.indexOf(ch);
    return i === -1 ? 0 : i;
  }

  function getChannel() {
    try { return localStorage.getItem(CHANNEL_KEY) || ''; } catch (e) { return ''; }
  }
  function setChannel(ch) {
    try { localStorage.setItem(CHANNEL_KEY, ch); } catch (e) { /* best effort */ }
  }
  function clearChannel() {
    try { localStorage.removeItem(CHANNEL_KEY); } catch (e) { /* best effort */ }
  }
  function isMuted() {
    try { return localStorage.getItem(MUTED_KEY) !== '0'; } catch (e) { return true; }
  }
  function setMuted(m) {
    try { localStorage.setItem(MUTED_KEY, m ? '1' : '0'); } catch (e) { /* best effort */ }
  }
  function getVolume() {
    try {
      var v = parseInt(localStorage.getItem(VOLUME_KEY), 10);
      return (v >= 0 && v <= 100) ? v : 70;
    } catch (e) { return 70; }
  }
  function setVolume(v) {
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch (e) { /* best effort */ }
  }
  function isExpanded() {
    try { return localStorage.getItem(EXPANDED_KEY) === '1'; } catch (e) { return false; }
  }
  function setExpanded(e) {
    try { localStorage.setItem(EXPANDED_KEY, e ? '1' : '0'); } catch (e) { /* best effort */ }
  }

  function extractYouTubeId(url) {
    var m = (url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
    return m ? m[1] : null;
  }
  function isSoundCloud(url) { return /soundcloud\.com/i.test(url || ''); }
  function isDirectAudio(url) { return /\.(mp3|wav|ogg|m4a)(\?|#|$)/i.test((url || '').split(/[?#]/)[0]); }

  /* ── YouTube IFrame Player API, loaded on demand (only if/when a
     YouTube track actually plays) ── */
  function ensureYouTubeApi(cb) {
    if (window.YT && window.YT.Player) { cb(); return; }
    ytApiCallbacks.push(cb);
    if (ytApiLoading) return;
    ytApiLoading = true;
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === 'function') prev();
      var cbs = ytApiCallbacks; ytApiCallbacks = [];
      cbs.forEach(function (fn) { fn(); });
    };
    var s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }

  /* ── SoundCloud Widget API, same on-demand loading ── */
  function ensureSoundCloudApi(cb) {
    if (window.SC && window.SC.Widget) { cb(); return; }
    scApiCallbacks.push(cb);
    if (scApiLoading) return;
    scApiLoading = true;
    var s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.onload = function () {
      var cbs = scApiCallbacks; scApiCallbacks = [];
      cbs.forEach(function (fn) { fn(); });
    };
    document.head.appendChild(s);
  }

  function destroyActivePlayers() {
    if (ytPlayer) { try { ytPlayer.destroy(); } catch (e) { /* already gone */ } ytPlayer = null; }
    scWidget = null; // SC.Widget doesn't need explicit teardown -- its iframe is about to be replaced/removed anyway
    currentEmbedKind = null;
  }

  /* ── DOM / styles ── */
  var style = document.createElement('style');
  style.textContent = [
    '#dg-radio{position:fixed;right:14px;bottom:14px;z-index:9998;',
    'font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;',
    'width:min(280px,calc(100vw - 28px));transition:width .15s ease;}',
    '#dg-radio.dgr-is-expanded{width:min(420px,calc(100vw - 28px));}',
    /* stats/index.html's collapsed Dice Roller bar also docks bottom-right
       on narrow screens (see #dr-panel's mobile rule in stats/styles.css)
       -- lift the radio pill clear of it instead of stacking on top. */
    '@media (max-width:600px){#dg-radio{bottom:78px;}}',
    '#dg-radio-pill{',
    'background:#161a14;color:#c9d4b8;border:1px solid #3a4432;border-radius:20px;',
    'padding:8px 14px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4);',
    'display:flex;align-items:center;gap:8px;user-select:none;width:fit-content;margin-left:auto;}',
    '#dg-radio-pill:hover{border-color:#5a6a48;}',
    '#dg-radio-panel{',
    'background:#161a14;color:#c9d4b8;border:1px solid #3a4432;border-radius:8px;',
    'padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.5);}',
    '#dg-radio-panel .dgr-head{',
    'display:flex;align-items:center;justify-content:space-between;gap:8px;',
    'font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#7a8a68;',
    'margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #2a3020;}',
    '#dg-radio-panel .dgr-head b{color:#a8c890;}',
    '#dg-radio-panel .dgr-btn{',
    'background:transparent;border:1px solid #3a4432;color:#c9d4b8;border-radius:4px;',
    'font-family:inherit;font-size:11px;padding:3px 7px;cursor:pointer;flex-shrink:0;}',
    '#dg-radio-panel .dgr-btn:hover{border-color:#5a6a48;}',
    /* ── mini bar: the persistent, always-visible controls, whether the
       panel is minimized or expanded ── */
    '.dgr-mini-bar{display:flex;align-items:center;gap:6px;}',
    '.dgr-mini-info{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e6ecd8;}',
    '.dgr-mini-info b{color:#a8c890;}',
    '.dgr-volume{width:52px;flex-shrink:0;accent-color:#6a9a40;}',
    '#dg-radio-panel:not(.dgr-panel-expanded) .dgr-expand-section{display:none;}',
    '.dgr-expand-section{margin-top:8px;}',
    '#dg-radio-track{font-size:12px;color:#e6ecd8;margin-bottom:4px;overflow-wrap:anywhere;}',
    '#dg-radio-status{font-size:10px;color:#7a8a68;margin-bottom:8px;}',
    '#dg-radio-resume{',
    'display:none;width:100%;margin-top:6px;background:#2a3a1c;color:#d8f0c0;',
    'border:1px solid #4a6a30;border-radius:4px;padding:6px;font-family:inherit;',
    'font-size:11px;letter-spacing:.05em;cursor:pointer;}',
    /* embed-wrap is ALWAYS rendered (never display:none) -- only its
       height collapses when minimized, so YouTube/SoundCloud keep
       playing off-screen instead of pausing. */
    '#dg-radio-embed-wrap{overflow:hidden;height:0;transition:height .15s ease;}',
    '#dg-radio-panel.dgr-panel-expanded #dg-radio-embed-wrap{height:220px;margin-top:8px;}',
    '#dg-radio-embed-wrap iframe, #dg-radio-embed-wrap audio, #dg-radio-embed-wrap>div{width:100%;height:220px;border:0;border-radius:4px;}',
    /* ── channel dial: a rotary knob with 5 fixed positions, turned
       instead of typed ── */
    '.dgr-dial-wrap{text-align:center;padding:2px 0 8px;}',
    '.dgr-dial{width:104px;height:104px;margin:0 auto 10px;position:relative;}',
    '.dgr-dial-ring{',
    'width:100%;height:100%;border-radius:50%;',
    'background:radial-gradient(circle at 35% 30%,#2a3020,#12160d 70%);',
    'border:2px solid #3a4432;position:relative;',
    'box-shadow:inset 0 0 10px rgba(0,0,0,.6),0 2px 6px rgba(0,0,0,.5);}',
    '.dgr-tick{',
    'position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;',
    'display:flex;align-items:center;justify-content:center;',
    'font-size:11px;color:#7a8a68;cursor:pointer;}',
    '.dgr-tick.active{color:#d8f0c0;font-weight:bold;}',
    '.dgr-knob{',
    'position:absolute;top:50%;left:50%;width:46px;height:46px;margin:-23px;',
    'border-radius:50%;background:radial-gradient(circle at 35% 30%,#4a5a3a,#1c2214 75%);',
    'border:1px solid #5a6a48;box-shadow:0 2px 4px rgba(0,0,0,.5);',
    'transition:transform .25s ease;}',
    '.dgr-pointer{',
    'position:absolute;top:4px;left:50%;width:2px;height:14px;',
    'background:#d8f0c0;margin-left:-1px;border-radius:1px;}',
    '.dgr-dial-controls{display:flex;align-items:center;justify-content:center;gap:10px;}',
    '.dgr-turn{',
    'background:#20261a;border:1px solid #3a4432;color:#c9d4b8;border-radius:50%;',
    'width:26px;height:26px;font-size:13px;cursor:pointer;line-height:1;padding:0;}',
    '.dgr-turn:hover{border-color:#5a6a48;}',
    '.dgr-dial-readout{font-size:12px;color:#e6ecd8;min-width:44px;}',
    '.dgr-dial-readout b{color:#a8c890;}',
    '.dgr-confirm{',
    'display:block;width:100%;background:#2a3a1c;color:#d8f0c0;',
    'border:1px solid #4a6a30;border-radius:4px;padding:7px;font-family:inherit;',
    'font-size:11px;letter-spacing:.05em;cursor:pointer;margin-top:2px;}',
    '.dgr-confirm:hover{border-color:#6a9a40;}',
  ].join('');
  document.head.appendChild(style);

  var root = document.createElement('div');
  root.id = 'dg-radio';
  document.body.appendChild(root);

  /* ── channel dial: 5 fixed positions on a rotary knob, turned instead
     of typed -- a real channel name field let two players land on
     "sam" vs "Sam" and never hear each other; a dial with a fixed set
     of stops can't be mistyped. ── */
  function dialHtml() {
    var ticks = CHANNELS.map(function (c) {
      return '<div class="dgr-tick" data-ch="' + c + '">' + c + '</div>';
    }).join('');
    return (
      '<div class="dgr-dial-wrap">' +
      '<div class="dgr-dial"><div class="dgr-dial-ring">' + ticks +
      '<div class="dgr-knob"><div class="dgr-pointer"></div></div>' +
      '</div></div>' +
      '<div class="dgr-dial-controls">' +
      '<button type="button" class="dgr-turn" data-dir="-1" aria-label="Turn dial left">&lt;</button>' +
      '<div class="dgr-dial-readout">CH <b class="dgr-dial-ch"></b></div>' +
      '<button type="button" class="dgr-turn" data-dir="1" aria-label="Turn dial right">&gt;</button>' +
      '</div></div>'
    );
  }
  function positionTicks(container) {
    var r = 40;
    var n = CHANNELS.length;
    Array.prototype.forEach.call(container.querySelectorAll('.dgr-tick'), function (el, i) {
      var angle = (i * (360 / n) - 90) * Math.PI / 180;
      el.style.left = 'calc(50% + ' + (r * Math.cos(angle)).toFixed(1) + 'px)';
      el.style.top = 'calc(50% + ' + (r * Math.sin(angle)).toFixed(1) + 'px)';
    });
  }
  function wireDial(container, initialCh, onChange) {
    var idx = channelIndex(initialCh);
    var knob = container.querySelector('.dgr-knob');
    var readout = container.querySelector('.dgr-dial-ch');
    var ticks = container.querySelectorAll('.dgr-tick');
    positionTicks(container);
    function render() {
      knob.style.transform = 'rotate(' + (idx * (360 / CHANNELS.length)) + 'deg)';
      readout.textContent = CHANNELS[idx];
      Array.prototype.forEach.call(ticks, function (t) {
        t.classList.toggle('active', t.getAttribute('data-ch') === CHANNELS[idx]);
      });
    }
    render();
    Array.prototype.forEach.call(container.querySelectorAll('.dgr-turn'), function (btn) {
      btn.addEventListener('click', function () {
        idx = (idx + parseInt(btn.getAttribute('data-dir'), 10) + CHANNELS.length) % CHANNELS.length;
        render();
        onChange(CHANNELS[idx]);
      });
    });
    Array.prototype.forEach.call(ticks, function (t) {
      t.addEventListener('click', function () {
        idx = channelIndex(t.getAttribute('data-ch'));
        render();
        onChange(CHANNELS[idx]);
      });
    });
    return { get: function () { return CHANNELS[idx]; } };
  }

  function renderCollapsed() {
    root.classList.remove('dgr-is-expanded');
    root.innerHTML = '<div id="dg-radio-pill">Tune In</div>';
    document.getElementById('dg-radio-pill').addEventListener('click', renderChoosing);
  }

  function renderChoosing() {
    root.classList.remove('dgr-is-expanded');
    root.innerHTML =
      '<div id="dg-radio-panel">' +
      '<div class="dgr-head"><span><b>Tune In</b></span>' +
      '<span><button type="button" class="dgr-btn" id="dg-radio-cancel">X</button></span></div>' +
      dialHtml() +
      '<button type="button" id="dg-radio-confirm-tune" class="dgr-confirm">Tune In</button>' +
      '</div>';
    var panel = document.getElementById('dg-radio-panel');
    var dial = wireDial(panel, getChannel() || CHANNELS[0], function () { /* live-preview only, commit on confirm */ });
    document.getElementById('dg-radio-cancel').addEventListener('click', renderCollapsed);
    document.getElementById('dg-radio-confirm-tune').addEventListener('click', function () {
      setChannel(dial.get());
      lastStartedAt = null;
      renderTuned();
      startPolling();
    });
  }

  function applyExpandedClass() {
    var panel = document.getElementById('dg-radio-panel');
    var expanded = isExpanded();
    root.classList.toggle('dgr-is-expanded', expanded);
    if (panel) panel.classList.toggle('dgr-panel-expanded', expanded);
    var btn = document.getElementById('dg-radio-toggle-expand');
    if (btn) btn.textContent = expanded ? 'Minimize' : 'Expand';
  }

  function renderTuned() {
    var ch = getChannel();
    root.innerHTML =
      '<div id="dg-radio-panel">' +
      '<div class="dgr-mini-bar">' +
      '<span class="dgr-mini-info"><b id="dg-radio-ch-label">CH ' + escapeHtml(ch) + '</b> <span id="dg-radio-mini-track">No signal yet.</span></span>' +
      '<button type="button" class="dgr-btn" id="dg-radio-mute">' + (isMuted() ? 'MUTED' : 'SOUND') + '</button>' +
      '<input type="range" class="dgr-volume" id="dg-radio-volume" min="0" max="100" step="1" value="' + getVolume() + '" title="Volume">' +
      '<button type="button" class="dgr-btn" id="dg-radio-toggle-expand">Expand</button>' +
      '<button type="button" class="dgr-btn" id="dg-radio-leave">X</button>' +
      '</div>' +
      '<div class="dgr-expand-section">' +
      '<button type="button" class="dgr-btn" id="dg-radio-change">Change Channel</button>' +
      '<div id="dg-radio-dial-slot"></div>' +
      '<div id="dg-radio-track">No signal yet.</div>' +
      '<div id="dg-radio-status">Waiting for the Handler…</div>' +
      '<button type="button" id="dg-radio-resume">Tap to resume audio</button>' +
      '</div>' +
      '<div id="dg-radio-embed-wrap"></div>' +
      '</div>';

    applyExpandedClass();

    document.getElementById('dg-radio-mute').addEventListener('click', function () {
      setMuted(!isMuted());
      var muteBtn = document.getElementById('dg-radio-mute');
      if (muteBtn) muteBtn.textContent = isMuted() ? 'MUTED' : 'SOUND';
      if (!applyLiveMuteVolume()) renderEmbed(window._dgRadioLast);
    });
    document.getElementById('dg-radio-volume').addEventListener('input', function (e) {
      setVolume(parseInt(e.target.value, 10) || 0);
      applyLiveMuteVolume();
    });
    document.getElementById('dg-radio-toggle-expand').addEventListener('click', function () {
      setExpanded(!isExpanded());
      applyExpandedClass();
    });
    document.getElementById('dg-radio-change').addEventListener('click', function () {
      var slot = document.getElementById('dg-radio-dial-slot');
      if (slot.childNodes.length) { slot.innerHTML = ''; return; }
      slot.innerHTML = dialHtml();
      wireDial(slot, ch, function (newCh) {
        if (newCh === ch) return;
        setChannel(newCh);
        ch = newCh;
        lastStartedAt = null;
        window._dgRadioLast = null;
        document.getElementById('dg-radio-ch-label').textContent = 'CH ' + newCh;
        document.getElementById('dg-radio-track').textContent = 'No signal yet.';
        document.getElementById('dg-radio-mini-track').textContent = 'No signal yet.';
        document.getElementById('dg-radio-status').textContent = 'Waiting for the Handler…';
        renderEmbed(null);
        startPolling();
      });
    });
    document.getElementById('dg-radio-leave').addEventListener('click', function () {
      stopPolling();
      clearChannel();
      window._dgRadioLast = null;
      destroyActivePlayers();
      renderCollapsed();
    });
    document.getElementById('dg-radio-resume').addEventListener('click', function () {
      setMuted(false);
      var muteBtn = document.getElementById('dg-radio-mute');
      if (muteBtn) muteBtn.textContent = 'SOUND';
      renderEmbed(window._dgRadioLast);
    });
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  }

  // Applies the current mute+volume state to whatever's actually playing
  // right now, WITHOUT tearing down and recreating the embed -- used for
  // the mute button and the volume slider, both of which fire far more
  // often than the track itself changes, and would otherwise restart the
  // YouTube/SoundCloud player on every single drag of the slider. Returns
  // false when nothing live-controllable is active (generic iframe, or
  // nothing playing yet), so the caller can fall back to a full
  // renderEmbed() rebuild where that's the only option.
  function applyLiveMuteVolume() {
    var muted = isMuted();
    var vol = getVolume();
    if (currentEmbedKind === 'yt' && ytPlayer && typeof ytPlayer.setVolume === 'function') {
      try {
        if (muted) { ytPlayer.mute(); } else { ytPlayer.unMute(); ytPlayer.setVolume(vol); }
        return true;
      } catch (e) { return false; }
    }
    if (currentEmbedKind === 'sc' && scWidget) {
      try { scWidget.setVolume(muted ? 0 : vol); return true; } catch (e) { return false; }
    }
    if (currentEmbedKind === 'audio') {
      var audioEl = document.getElementById('dg-radio-audio');
      if (audioEl) { audioEl.muted = muted; audioEl.volume = vol / 100; return true; }
    }
    return false;
  }

  function renderEmbed(np) {
    var wrap = document.getElementById('dg-radio-embed-wrap');
    var resumeBtn = document.getElementById('dg-radio-resume');
    var muteBtn = document.getElementById('dg-radio-mute');
    var volSlider = document.getElementById('dg-radio-volume');
    if (!wrap) return; // panel not on screen (e.g. collapsed)
    if (muteBtn) muteBtn.textContent = isMuted() ? 'MUTED' : 'SOUND';

    destroyActivePlayers();

    if (!np || !np.track_url) {
      wrap.innerHTML = '';
      resumeBtn.style.display = 'none';
      if (volSlider) volSlider.style.display = '';
      return;
    }

    var elapsed = Math.max(0, Math.floor((Date.now() - (np.started_at || Date.now())) / 1000));
    var muted = isMuted();
    var vol = getVolume();
    var ytId = extractYouTubeId(np.track_url);

    if (ytId) {
      currentEmbedKind = 'yt';
      if (volSlider) volSlider.style.display = '';
      wrap.innerHTML = '<div id="dg-radio-yt-target"></div>';
      resumeBtn.style.display = 'none';
      ensureYouTubeApi(function () {
        if (!document.getElementById('dg-radio-yt-target')) return; // superseded by a later renderEmbed() call
        ytPlayer = new window.YT.Player('dg-radio-yt-target', {
          height: '220', width: '100%', videoId: ytId,
          playerVars: { autoplay: 1, start: elapsed, mute: muted ? 1 : 0, playsinline: 1 },
          events: {
            onReady: function (e) {
              try {
                e.target.setVolume(vol);
                if (muted) e.target.mute(); else e.target.unMute();
                e.target.playVideo();
              } catch (e2) { /* best effort */ }
            }
          }
        });
      });
    } else if (isSoundCloud(np.track_url)) {
      currentEmbedKind = 'sc';
      if (volSlider) volSlider.style.display = '';
      wrap.innerHTML = '<iframe id="dg-radio-sc-iframe" height="220" src="https://w.soundcloud.com/player/?url=' +
        encodeURIComponent(np.track_url) + '&auto_play=true' + '" allow="autoplay" title="Table Radio"></iframe>';
      resumeBtn.style.display = 'none';
      ensureSoundCloudApi(function () {
        var iframeEl = document.getElementById('dg-radio-sc-iframe');
        if (!iframeEl) return; // superseded by a later renderEmbed() call
        scWidget = window.SC.Widget(iframeEl);
        scWidget.bind(window.SC.Widget.Events.READY, function () {
          try { scWidget.setVolume(muted ? 0 : vol); } catch (e) { /* best effort */ }
        });
      });
    } else if (isDirectAudio(np.track_url)) {
      currentEmbedKind = 'audio';
      if (volSlider) volSlider.style.display = '';
      wrap.innerHTML = '<audio id="dg-radio-audio" src="' + escapeHtml(np.track_url) + '"></audio>';
      var audioEl = document.getElementById('dg-radio-audio');
      audioEl.currentTime = elapsed;
      audioEl.muted = muted;
      audioEl.volume = vol / 100;
      var playPromise = audioEl.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () { resumeBtn.style.display = 'block'; });
      }
    } else {
      // Generic embeddable URL, neither YouTube, SoundCloud, nor direct
      // audio -- no API, cross-origin, never controllable from here
      // (mute/volume weren't controllable for this case before this
      // redesign either). Hide the slider instead of showing a dead one.
      currentEmbedKind = 'generic';
      if (volSlider) volSlider.style.display = 'none';
      wrap.innerHTML = '<iframe src="' + escapeHtml(np.track_url) + '" allow="autoplay" title="Table Radio"></iframe>';
      // Can't detect this iframe's playback failures directly
      // (cross-origin) -- if starting muted, offer the resume tap so the
      // player can opt into sound; browsers always allow muted autoplay,
      // so an unmuted attempt here has already either worked or the tab
      // was never going to make sound without a tap regardless.
      resumeBtn.style.display = muted ? 'block' : 'none';
    }
  }

  function poll() {
    var ch = getChannel();
    if (!ch) return;
    // A stale in-flight request (slow network, dropped response) shouldn't
    // pile up scripts/globals every POLL_MS -- clear whatever the previous
    // cycle left pending before starting a new one.
    var prevScript = document.getElementById('_dg_radio_poll_script');
    if (prevScript) prevScript.remove();
    var cbName = '_dgRadioPoll_' + Date.now();
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      delete window[cbName];
    }, 5000);
    window[cbName] = function (res) {
      if (timedOut) return;
      clearTimeout(timer);
      delete window[cbName];
      var s = document.getElementById('_dg_radio_poll_script');
      if (s) s.remove();
      var statusEl = document.getElementById('dg-radio-status');
      var trackEl = document.getElementById('dg-radio-track');
      var miniTrackEl = document.getElementById('dg-radio-mini-track');
      if (!res || res.status !== 'OK' || !res.track_url) {
        if (statusEl) statusEl.textContent = 'Waiting for the Handler…';
        if (trackEl) trackEl.textContent = 'No signal yet.';
        if (miniTrackEl) miniTrackEl.textContent = 'No signal yet.';
        if (lastStartedAt) { window._dgRadioLast = null; renderEmbed(null); }
        lastStartedAt = null;
        return;
      }
      var label = res.track_title || res.track_url;
      if (trackEl) trackEl.textContent = label;
      if (miniTrackEl) miniTrackEl.textContent = label;
      if (statusEl) statusEl.textContent = 'On air';
      if (res.started_at !== lastStartedAt) {
        lastStartedAt = res.started_at;
        window._dgRadioLast = res;
        renderEmbed(res);
      }
    };
    var s = document.createElement('script');
    s.id = '_dg_radio_poll_script';
    s.src = APPS_SCRIPT_URL + '?action=get_now_playing&channel=' + encodeURIComponent(ch) + '&callback=' + cbName;
    document.head.appendChild(s);
  }

  function startPolling() {
    stopPolling();
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  if (getChannel()) {
    renderTuned();
    startPolling();
  } else {
    renderCollapsed();
  }
})();
