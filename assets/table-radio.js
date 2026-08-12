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

   Ambient layers (rain/wind/static, playing underneath whatever
   track is tuned) require a further addition,
   acell-table-radio-ambient-addition.gs -- also handed over separately.
   Until it's pasted in, get_now_playing simply won't carry an
   ambient_layers field and every ambient row silently stays hidden,
   same graceful-degradation-until-deployed pattern as everything else
   in this app.

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
  // Was 6000ms -- shortened as a zero-new-infra latency cut (still one
  // JSONP GET to Apps Script/Sheets per tick, so this is a stopgap, not
  // real push; a table-sized group's poll traffic is nowhere near
  // Apps Script's execution quotas at this interval).
  var POLL_MS = 2000;
  // Fixed numbered channels, picked by turning a dial rather than typing a
  // name -- five slots, no typos, no two players landing on "sam" vs "Sam".
  var CHANNELS = ['1', '2', '3', '4', '5'];
  // Ambient loops that can play UNDERNEATH whatever's tuned on a channel
  // (rain/wind/static, Handler-toggled, one on/off state per channel --
  // see get_now_playing's ambient_layers field). Fixed client-side set:
  // the backend only ever sends {id, active, started_at}, never a URL, so
  // the client resolves id -> its own bundled asset + label.
  var AMBIENT_LAYERS = [
    { id: 'rain', label: 'Rain', src: 'assets/ambient/rain.mp3' },
    { id: 'wind', label: 'Wind', src: 'assets/ambient/wind.mp3' },
    { id: 'static', label: 'Interference', src: 'assets/ambient/static.mp3' }
  ];
  var AMBIENT_MUTED_KEY_PREFIX = 'dg_radio_ambient_muted_'; // + layer id
  // Stingers -- one-shot sound effects (a gunshot, a scream, a knock),
  // fundamentally different from ambient layers' persistent on/off
  // state: there's only ever "the most recently fired stinger" per
  // channel (see get_now_playing's last_stinger field), stamped fresh on
  // every single trigger so re-firing the same sound twice in a row
  // still plays twice. Same fixed client-side id->asset resolution as
  // AMBIENT_LAYERS -- the backend only ever sends {id, fired_at}.
  var STINGERS = [
    { id: 'knock', src: 'assets/stingers/knock.mp3' },
    { id: 'wood-creak', src: 'assets/stingers/wood-creak.mp3' },
    { id: 'gunshot-pistol', src: 'assets/stingers/gunshot-pistol.mp3' },
    { id: 'gunshot-shotgun', src: 'assets/stingers/gunshot-shotgun.mp3' },
    { id: 'gunshot-rifle-semi', src: 'assets/stingers/gunshot-rifle-semi.mp3' },
    { id: 'gunshot-rifle-auto', src: 'assets/stingers/gunshot-rifle-auto.mp3' },
    { id: 'explosion-small', src: 'assets/stingers/explosion-small.mp3' },
    { id: 'explosion-medium', src: 'assets/stingers/explosion-medium.mp3' },
    { id: 'explosion-large', src: 'assets/stingers/explosion-large.mp3' },
    { id: 'scream-woman', src: 'assets/stingers/scream-woman.mp3' },
    { id: 'scream-man', src: 'assets/stingers/scream-man.mp3' },
    { id: 'child-laughter', src: 'assets/stingers/child-laughter.mp3' },
    { id: 'child-crying', src: 'assets/stingers/child-crying.mp3' }
  ];

  var lastStartedAt = null;
  var lastPaused = false;
  // Last known {active, started_at} per ambient layer id, for the same
  // "only touch what actually changed" diffing the main track already
  // does with lastStartedAt/lastPaused -- reset alongside those at every
  // channel-change/leave point (see below) since a fresh channel means
  // fresh, unknown ambient state.
  var lastAmbientState = {};
  // The fired_at of the last stinger this tab has actually PLAYED (or, on
  // the very first poll after tuning in, the fired_at it's chosen to
  // treat as already-seen -- see stingerPrimed below and applyStinger()).
  var lastStingerFiredAt = null;
  // False until the first post-tune-in poll response has been read. A
  // channel's last-fired stinger might be old news (fired minutes ago,
  // long before this tab tuned in) -- without this, every fresh tune-in
  // would immediately replay whatever the last stinger happened to be,
  // which is exactly the "surprise" a stinger is supposed to be, just
  // triggered by the wrong thing (joining the channel, not the Handler).
  // The first response after (re)tuning primes lastStingerFiredAt without
  // playing anything; only a CHANGE after that counts as a new trigger.
  var stingerPrimed = false;
  var pollTimer = null;

  // Which live-controllable player (if any) currently backs the embed --
  // drives whether a mute/volume change can be applied in place (cheap,
  // no reload) or needs a full renderEmbed() rebuild.
  var currentEmbedKind = null; // 'yt' | 'sc' | 'audio' | 'generic' | null
  var ytPlayer = null;
  // A freshly-constructed YT.Player object exists synchronously, well
  // before the real embedded player has finished its handshake --
  // calling setVolume()/mute() on it during that window silently no-ops
  // in real YouTube embeds instead of throwing, so `ytPlayer` existing
  // is NOT a safe readiness signal on its own. This flag is the actual
  // one, set only inside onReady.
  var ytPlayerReady = false;
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
  // Ambient layer mute is per-layer, and -- same as the main track's
  // MUTED_KEY -- defaults to MUTED, NOT because the Handler's choice is in
  // question, but because browsers reliably allow autoplay only when
  // starting muted; an unmuted <audio>.play() call with no prior user
  // gesture on the page gets silently rejected in most browsers, which
  // would make an ambient layer the Handler just turned on simply never
  // start for a listener who hasn't interacted with the page yet. The
  // existing "Tap to resume audio" button (see #dg-radio-resume's click
  // handler in renderTuned()) un-mutes the main track AND every ambient
  // layer together in one tap, rather than needing 4 separate taps.
  function isAmbientMuted(layerId) {
    try { return localStorage.getItem(AMBIENT_MUTED_KEY_PREFIX + layerId) !== '0'; } catch (e) { return true; }
  }
  function setAmbientMuted(layerId, m) {
    try { localStorage.setItem(AMBIENT_MUTED_KEY_PREFIX + layerId, m ? '1' : '0'); } catch (e) { /* best effort */ }
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
    ytPlayerReady = false;
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
    // width:auto is deliberate, not decorative: stats/styles.css has a
    // mobile rule (button{width:100%}) meant for the page's OWN buttons
    // stacking full-width on narrow screens -- being a bare `button`
    // selector, it also grabs this widget's plain <button> elements
    // once appended to <body>, stretching Mute/Expand/Leave to the full
    // panel width and blowing the mini-bar's layout apart (each button
    // fighting the others for 100%, overflowing past the panel's own
    // edge). This selector's specificity beats that bare one, so it's
    // the fix, not just a style choice.
    'width:auto;',
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
    /* ── ambient layers: rows are ALWAYS in the DOM (so the <audio>
       elements persist across Minimize/Expand, same "clipped not
       removed" principle as the main embed) but individually hidden
       until their layer is actually active. ── */
    '.dgr-ambient-label-row{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#7a8a68;margin:10px 0 4px;}',
    '.dgr-ambient-row{display:flex;align-items:center;gap:8px;padding:4px 0;}',
    '.dgr-ambient-label{flex:1;min-width:0;font-size:11px;color:#c9d4b8;}',
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
      lastPaused = false;
      lastAmbientState = {};
      window._dgRadioLastAmbient = null;
      stingerPrimed = false;
      lastStingerFiredAt = null;
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

  // Builds the 4 (always-in-DOM, individually-hidden) ambient layer rows
  // once, inside renderTuned()'s fresh markup. Additive/parallel to the
  // main track's embed -- never touches currentEmbedKind/renderEmbed()/
  // destroyActivePlayers(), which stay exactly as they were for the one
  // main track (YouTube/SoundCloud/audio/generic iframe).
  function renderAmbientRows() {
    var wrap = document.getElementById('dg-radio-ambient-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="dgr-ambient-label-row">Ambience</div>' + AMBIENT_LAYERS.map(function (layer) {
      return '<div class="dgr-ambient-row" data-layer="' + layer.id + '" style="display:none">' +
        '<span class="dgr-ambient-label">' + escapeHtml(layer.label) + '</span>' +
        '<button type="button" class="dgr-btn" data-ambient-mute="' + layer.id + '">' +
        (isAmbientMuted(layer.id) ? 'MUTED' : 'SOUND') + '</button>' +
        '<audio id="dg-radio-ambient-' + layer.id + '" loop preload="none"></audio>' +
        '</div>';
    }).join('');
    // Delegated (not per-button) since this wrap is only ever built fresh
    // once per renderTuned() call -- one listener per fresh DOM, no
    // stacking risk.
    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ambient-mute]');
      if (!btn) return;
      var layerId = btn.getAttribute('data-ambient-mute');
      var muted = !isAmbientMuted(layerId);
      setAmbientMuted(layerId, muted);
      btn.textContent = muted ? 'MUTED' : 'SOUND';
      // Mutes in place without touching playback/src -- same shape as
      // applyLiveMuteVolume() for the main track, just scoped to one
      // <audio> element instead of dispatching on currentEmbedKind.
      var audioEl = document.getElementById('dg-radio-ambient-' + layerId);
      if (audioEl) audioEl.muted = muted;
    });
  }

  // Diffs the server's ambient_layers array against lastAmbientState and
  // starts/stops only the ONE <audio> element whose active flag actually
  // flipped -- called on every poll tick (ambient toggles are independent
  // events from the main track's started_at/paused changes, so this can't
  // piggyback on those diff branches) and once right after renderTuned()
  // builds fresh DOM, so an Expand click (or a fresh tune-in) applies
  // already-known state immediately rather than waiting for the next tick.
  function applyAmbientLayers(layers) {
    (layers || []).forEach(function (layer) {
      var prev = lastAmbientState[layer.id];
      var audioEl = document.getElementById('dg-radio-ambient-' + layer.id);
      var row = document.querySelector('.dgr-ambient-row[data-layer="' + layer.id + '"]');
      if (layer.active) {
        if (row) row.style.display = '';
        if (audioEl && (!prev || !prev.active || prev.started_at !== layer.started_at)) {
          // OFF->ON, or a NEW started_at while still on (Handler
          // re-triggered it) -- (re)start. Same started_at + still active
          // falls through untouched -- the common case, true on nearly
          // every poll tick since Handler state rarely changes tick to
          // tick, and exactly why a restart-on-every-poll bug would be
          // so disruptive here (a seamless loop restarting every 2s
          // reads as very much NOT seamless).
          var layerDef = AMBIENT_LAYERS.filter(function (l) { return l.id === layer.id; })[0];
          if (layerDef && !audioEl.src) audioEl.src = layerDef.src;
          audioEl.currentTime = 0;
          audioEl.muted = isAmbientMuted(layer.id);
          var p = audioEl.play();
          if (p && p.catch) {
            p.catch(function () { /* autoplay-blocked -- no dedicated
              per-layer resume button in v1; the main track's own "Tap to
              resume audio" button, when shown, satisfies the same
              user-gesture requirement for the whole page's audio context,
              ambient layers included. */ });
          }
        }
      } else {
        if (row) row.style.display = 'none';
        if (audioEl && prev && prev.active) audioEl.pause();
      }
      lastAmbientState[layer.id] = { active: layer.active, started_at: layer.started_at };
    });
  }

  // Pauses every ambient layer and hides its row -- used on channel
  // change/leave, where a fresh channel means fresh, unknown ambient
  // state (the src itself doesn't need clearing: it's a fixed local file
  // per layer id, not channel-dependent, so it's fine to just pause and
  // let the next applyAmbientLayers() call decide what SHOULD be playing
  // for the new channel).
  function stopAllAmbientAudio() {
    AMBIENT_LAYERS.forEach(function (layer) {
      var audioEl = document.getElementById('dg-radio-ambient-' + layer.id);
      if (audioEl) audioEl.pause();
      var row = document.querySelector('.dgr-ambient-row[data-layer="' + layer.id + '"]');
      if (row) row.style.display = 'none';
    });
  }

  // Plays one stinger, once. Unlike ambient layers (one persistent
  // <audio> per layer id, reused across triggers), a fresh <audio>
  // element is created per FIRING -- an auto-rifle burst stinger could
  // in principle be re-triggered again before its first play finishes,
  // and each firing is its own independent one-shot sound, not a
  // loop/toggle to reuse or interrupt. Removed from the DOM once
  // playback ends (or fails) so repeated firings don't accumulate stale
  // elements. Deliberately reuses the MAIN track's mute/volume prefs,
  // not a separate per-stinger control -- a stinger is "table audio"
  // same as the music, and a listener who's muted the widget doesn't
  // want to suddenly hear an unmuted scream because of a setting they
  // never got to see, let alone touch.
  function playStinger(stingerId) {
    var def = STINGERS.filter(function (s) { return s.id === stingerId; })[0];
    if (!def) return; // unknown id -- ignore rather than error
    var el = document.createElement('audio');
    el.src = def.src;
    el.muted = isMuted();
    el.volume = getVolume() / 100;
    el.addEventListener('ended', function () { el.remove(); });
    document.body.appendChild(el);
    var p = el.play();
    if (p && p.catch) p.catch(function () { el.remove(); /* autoplay-blocked -- best effort, same as every other playback attempt in this widget */ });
  }

  // Diffs the server's last_stinger against what this tab has already
  // primed/played -- called on every poll tick, independent of the main
  // track's and ambient layers' own diff branches (a stinger can fire on
  // its own, with nothing else changing that tick).
  function applyStinger(lastStinger) {
    if (!lastStinger) { stingerPrimed = true; return; }
    if (!stingerPrimed) {
      // First response since (re)tuning -- this may be old news from
      // long before this tab joined the channel; note it without
      // playing (see stingerPrimed's own comment above for why).
      lastStingerFiredAt = lastStinger.fired_at;
      stingerPrimed = true;
      return;
    }
    if (lastStinger.fired_at !== lastStingerFiredAt) {
      lastStingerFiredAt = lastStinger.fired_at;
      playStinger(lastStinger.id);
    }
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
      '<div id="dg-radio-ambient-wrap"></div>' +
      '</div>' +
      '<div id="dg-radio-embed-wrap"></div>' +
      '</div>';

    applyExpandedClass();
    renderAmbientRows();
    applyAmbientLayers(window._dgRadioLastAmbient);

    document.getElementById('dg-radio-mute').addEventListener('click', function () {
      setMuted(!isMuted());
      var muteBtn = document.getElementById('dg-radio-mute');
      if (muteBtn) muteBtn.textContent = isMuted() ? 'MUTED' : 'SOUND';
      if (!applyLiveMuteVolume()) renderEmbed(window._dgRadioLast);
    });
    document.getElementById('dg-radio-volume').addEventListener('input', function (e) {
      setVolume(parseInt(e.target.value, 10) || 0);
      // Dragging the volume slider implies wanting to hear that level --
      // without this, a still-Muted widget (the default until the first
      // Sound tap) would apply the new volume internally but stay
      // silent, reading as "the volume slider doesn't do anything" even
      // though it technically did.
      if (isMuted()) {
        setMuted(false);
        var muteBtn = document.getElementById('dg-radio-mute');
        if (muteBtn) muteBtn.textContent = 'SOUND';
      }
      if (!applyLiveMuteVolume()) renderEmbed(window._dgRadioLast);
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
        lastPaused = false;
        lastAmbientState = {};
        window._dgRadioLast = null;
        window._dgRadioLastAmbient = null;
        stingerPrimed = false;
        lastStingerFiredAt = null;
        document.getElementById('dg-radio-ch-label').textContent = 'CH ' + newCh;
        document.getElementById('dg-radio-track').textContent = 'No signal yet.';
        document.getElementById('dg-radio-mini-track').textContent = 'No signal yet.';
        document.getElementById('dg-radio-status').textContent = 'Waiting for the Handler…';
        renderEmbed(null);
        stopAllAmbientAudio();
        startPolling();
      });
    });
    document.getElementById('dg-radio-leave').addEventListener('click', function () {
      stopPolling();
      clearChannel();
      window._dgRadioLast = null;
      window._dgRadioLastAmbient = null;
      lastAmbientState = {};
      stingerPrimed = false;
      lastStingerFiredAt = null;
      destroyActivePlayers();
      stopAllAmbientAudio();
      renderCollapsed();
    });
    document.getElementById('dg-radio-resume').addEventListener('click', function () {
      setMuted(false);
      var muteBtn = document.getElementById('dg-radio-mute');
      if (muteBtn) muteBtn.textContent = 'SOUND';
      // This tap is a real user gesture -- the one thing that satisfies
      // browsers' autoplay-with-sound requirement -- so it un-mutes every
      // currently-playing ambient layer too, not just the main track.
      // One tap for everything rather than 4 separate per-layer taps.
      AMBIENT_LAYERS.forEach(function (layer) {
        setAmbientMuted(layer.id, false);
        var btn = document.querySelector('[data-ambient-mute="' + layer.id + '"]');
        if (btn) btn.textContent = 'SOUND';
        var audioEl = document.getElementById('dg-radio-ambient-' + layer.id);
        if (audioEl) audioEl.muted = false;
      });
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
    if (currentEmbedKind === 'yt' && ytPlayer && ytPlayerReady) {
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

  // Handler-driven Pause/Resume: pauses or resumes whatever's actually
  // playing right now WITHOUT tearing down and recreating the embed (a
  // poll landing mid-pause shouldn't restart the track for every
  // listener). Returns false if nothing live-controllable is active, so
  // the caller can fall back to a full renderEmbed() rebuild.
  function applyLivePauseState(paused) {
    if (currentEmbedKind === 'yt' && ytPlayer && ytPlayerReady) {
      try { if (paused) ytPlayer.pauseVideo(); else ytPlayer.playVideo(); return true; } catch (e) { return false; }
    }
    if (currentEmbedKind === 'sc' && scWidget) {
      try { if (paused) scWidget.pause(); else scWidget.play(); return true; } catch (e) { return false; }
    }
    if (currentEmbedKind === 'audio') {
      var audioEl = document.getElementById('dg-radio-audio');
      if (audioEl) {
        if (paused) { audioEl.pause(); } else { var p = audioEl.play(); if (p && p.catch) p.catch(function () { /* best effort */ }); }
        return true;
      }
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

    var isPaused = !!np.paused;
    var pausedAtMs = np.paused_at || Date.now();
    var elapsed = isPaused
      ? Math.max(0, Math.floor((pausedAtMs - (np.started_at || pausedAtMs)) / 1000))
      : Math.max(0, Math.floor((Date.now() - (np.started_at || Date.now())) / 1000));
    var muted = isMuted();
    var vol = getVolume();
    var loop = !!np.loop;
    // A Track Library pick's Drive download link has no .mp3 extension
    // for isDirectAudio() to catch -- track_kind says so explicitly
    // instead of relying on the URL shape, and skips the YouTube/
    // SoundCloud sniffing entirely rather than risking a false match.
    var isLibraryAudio = np.track_kind === 'audio';
    var ytId = isLibraryAudio ? null : extractYouTubeId(np.track_url);

    if (ytId) {
      currentEmbedKind = 'yt';
      if (volSlider) volSlider.style.display = '';
      wrap.innerHTML = '<div id="dg-radio-yt-target"></div>';
      resumeBtn.style.display = 'none';
      ensureYouTubeApi(function () {
        if (!document.getElementById('dg-radio-yt-target')) return; // superseded by a later renderEmbed() call
        var playerVars = {
          // Paused broadcasts cue up at the right timestamp without
          // visibly flashing into playback first (autoplay 0 + start).
          autoplay: isPaused ? 0 : 1, start: elapsed, mute: muted ? 1 : 0, playsinline: 1,
          // origin is YouTube's own recommended playerVar for the
          // postMessage-based control channel (setVolume/mute/etc) --
          // without it the video can still play visibly while those
          // calls go nowhere, which is exactly the "sound plays, volume
          // slider does nothing" shape of bug this was chasing.
          origin: window.location.origin
        };
        // A single video only loops via the API by also naming itself as
        // a one-item "playlist" -- loop:1 alone is silently ignored.
        if (loop) { playerVars.loop = 1; playerVars.playlist = ytId; }
        ytPlayer = new window.YT.Player('dg-radio-yt-target', {
          height: '220', width: '100%', videoId: ytId,
          playerVars: playerVars,
          events: {
            onReady: function (e) {
              ytPlayerReady = true;
              try {
                e.target.setVolume(getVolume());
                if (isMuted()) e.target.mute(); else e.target.unMute();
                if (!isPaused) e.target.playVideo();
              } catch (e2) { /* best effort */ }
            }
          }
        });
      });
    } else if (!isLibraryAudio && isSoundCloud(np.track_url)) {
      currentEmbedKind = 'sc';
      if (volSlider) volSlider.style.display = '';
      wrap.innerHTML = '<iframe id="dg-radio-sc-iframe" height="220" src="https://w.soundcloud.com/player/?url=' +
        encodeURIComponent(np.track_url) + '&auto_play=' + (isPaused ? 'false' : 'true') + '" allow="autoplay" title="Table Radio"></iframe>';
      resumeBtn.style.display = 'none';
      ensureSoundCloudApi(function () {
        var iframeEl = document.getElementById('dg-radio-sc-iframe');
        if (!iframeEl) return; // superseded by a later renderEmbed() call
        scWidget = window.SC.Widget(iframeEl);
        scWidget.bind(window.SC.Widget.Events.READY, function () {
          try { scWidget.setVolume(muted ? 0 : vol); } catch (e) { /* best effort */ }
        });
      });
    } else if (isLibraryAudio || isDirectAudio(np.track_url)) {
      currentEmbedKind = 'audio';
      if (volSlider) volSlider.style.display = '';
      wrap.innerHTML = '<audio id="dg-radio-audio" src="' + escapeHtml(np.track_url) + '"></audio>';
      var audioEl = document.getElementById('dg-radio-audio');
      audioEl.currentTime = elapsed;
      audioEl.muted = muted;
      audioEl.volume = vol / 100;
      audioEl.loop = loop;
      // A bad/unreachable src (e.g. a broken Drive hotlink) otherwise
      // fails completely silently -- no sound, no visible sign why.
      audioEl.addEventListener('error', function () {
        var statusEl = document.getElementById('dg-radio-status');
        if (statusEl) statusEl.textContent = 'Playback failed -- this track isn\'t reachable right now.';
      });
      if (!isPaused) {
        var playPromise = audioEl.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(function () { resumeBtn.style.display = 'block'; });
        }
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
      // Ambient layers are independent of whether a main track is set --
      // the Handler might have rain playing with no music cued at all --
      // so this has to run before the "no track" early-return below, not
      // gated behind it. Also NOT gated on res.status === 'OK': a channel
      // with no track set responds status:'NOT_FOUND' (see the early
      // return just below), and ambient_layers still has to be read from
      // that response too -- gating on 'OK' would mean ambient layers
      // could only ever play alongside an actual track, never on their
      // own.
      if (res && res.ambient_layers) {
        window._dgRadioLastAmbient = res.ambient_layers;
        applyAmbientLayers(res.ambient_layers);
      }
      // Same reasoning as ambient_layers just above: independent of
      // whether a main track is set, and not gated on res.status.
      if (res) applyStinger(res.last_stinger);
      if (!res || res.status !== 'OK' || !res.track_url) {
        if (statusEl) statusEl.textContent = 'Waiting for the Handler…';
        if (trackEl) trackEl.textContent = 'No signal yet.';
        if (miniTrackEl) miniTrackEl.textContent = 'No signal yet.';
        if (lastStartedAt) { window._dgRadioLast = null; renderEmbed(null); }
        lastStartedAt = null;
        lastPaused = false;
        return;
      }
      var label = res.track_title || res.track_url;
      if (trackEl) trackEl.textContent = label;
      if (miniTrackEl) miniTrackEl.textContent = label;
      if (statusEl) statusEl.textContent = res.paused ? 'Paused by the Handler' : 'On air';
      if (res.started_at !== lastStartedAt) {
        lastStartedAt = res.started_at;
        lastPaused = !!res.paused;
        window._dgRadioLast = res;
        renderEmbed(res);
      } else if (!!res.paused !== lastPaused) {
        // Same track, only the pause state flipped -- toggle the live
        // player in place instead of a full rebuild (which would restart
        // YouTube/SoundCloud from scratch on every Pause/Resume click).
        lastPaused = !!res.paused;
        window._dgRadioLast = res;
        if (!applyLivePauseState(lastPaused)) renderEmbed(res);
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
