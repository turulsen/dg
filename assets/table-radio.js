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

   Now Playing sync: reads radio/{channel} in Firestore via a live
   onSnapshot listener (Firebase migration Phase 2), not a poll loop --
   the Handler's set/pause/resume_now_playing Apps Script actions keep
   that document current via Code.gs's dual-write bridge (see
   docs/firebase-migration/). Read-only and public (see firestore.rules)
   -- no sign-in needed for this widget, only the Handler-side A-Cell
   Music tab (a separate file, untouched by this phase) writes.

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
  // Inside the app shell (hub.html), the shell owns one hoisted copy of
  // this widget outside #dg-shell-content entirely -- a page loaded
  // *into* that iframe (e.g. agent-hub.html) must not also mount its
  // own, or both sit at the same fixed bottom-right position (this
  // widget's #dg-radio is position:fixed, which is relative to
  // whichever document it's actually in -- the iframe's own viewport
  // here, landing almost exactly on top of the shell's real one) with
  // no way to tell which pill is which, and only the inner copy (which
  // a real navigation destroys) would ever actually be reachable to tap.
  // Same reasoning for stats/index.html's own #dg-split-sheet-frame --
  // Split View's sheet pane is a real second copy of that same page
  // (self-referencing iframe), so its own dice-roller.js/table-radio.js
  // include would otherwise mount a second widget too, live-reported as
  // "double dice roller" when entering Live Play. window.frameElement
  // is same-origin-only, so this is null for every standalone visit and
  // for any other embedding not in this explicit list.
  if (window.frameElement &&
      (window.frameElement.id === 'dg-shell-content' || window.frameElement.id === 'dg-split-sheet-frame')) return;
  var FIREBASE_SDK_VERSION = '12.18.0';
  // Public Web SDK config for the dg-app-b3447 Firebase project -- not
  // a secret, same reasoning as every other client-side Firebase config;
  // security is enforced by firestore.rules, not by hiding this object.
  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBiFBvgmrjtacxXvh7FHa9a28BbwV0LnDQ',
    authDomain: 'dg-app-b3447.firebaseapp.com',
    projectId: 'dg-app-b3447',
    storageBucket: 'dg-app-b3447.firebasestorage.app',
    messagingSenderId: '464997490443',
    appId: '1:464997490443:web:dad47a347ae7a64a9e4c0e'
  };
  var CHANNEL_KEY = 'dg_radio_channel';
  var MUTED_KEY = 'dg_radio_muted';
  var VOLUME_KEY = 'dg_radio_volume';
  var EXPANDED_KEY = 'dg_radio_expanded';
  // Fixed numbered channels, picked by turning a dial rather than typing a
  // name -- five slots, no typos, no two players landing on "sam" vs "Sam".
  var CHANNELS = ['1', '2', '3', '4', '5'];

  var lastStartedAt = null;
  var lastPaused = false;

  // Which live-controllable player (if any) currently backs the embed --
  // drives whether a mute/volume change can be applied in place (cheap,
  // no reload) or needs a full renderEmbed() rebuild.
  var currentEmbedKind = null; // 'yt' | 'sc' | 'audio' | 'generic' | null
  // True only while the CURRENT broadcast state is a real Handler-
  // paused one (applyLivePauseState(true)/renderEmbed() loading an
  // already-paused np) -- set alongside every intentional pause of
  // #dg-radio-audio, so its own 'pause' listener below can tell that
  // apart from an unprompted one and know whether to auto-resume.
  var intentionalPause = false;
  var ytPlayer = null;
  // A freshly-constructed YT.Player object exists synchronously, well
  // before the real embedded player has finished its handshake --
  // calling setVolume()/mute() on it during that window silently no-ops
  // in real YouTube embeds instead of throwing, so `ytPlayer` existing
  // is NOT a safe readiness signal on its own. This flag is the actual
  // one, set only inside onReady.
  var ytPlayerReady = false;
  var scWidget = null;
  // SoundCloud's Widget API is callback-based, not a synchronous getter
  // like YouTube's or <audio>'s own .currentTime -- duration is fetched
  // once on READY and cached here; position is pushed by the widget's
  // own PLAY_PROGRESS event rather than polled, since getPosition() is
  // also callback-based and polling it every tick would mean a new
  // postMessage round-trip to the iframe every second for no benefit.
  var scDuration = null;
  var scPosition = 0;
  var ytApiLoading = false;
  var ytApiCallbacks = [];
  // Ambient loops + one-shot stingers: the Table Radio soundboard, fully
  // independent of the main "Now Playing" track/embed above -- ambience
  // can run under a track, over silence, or across a track change, so it
  // gets its own teardown/volume handling instead of folding into
  // destroyActivePlayers()/renderEmbed(), which only ever concern the
  // single primary track. Real recorded SFX, replacing an earlier
  // procedurally-synthesized attempt that was built, tested, and
  // deliberately abandoned for poor audio quality (see design-graveyard/
  // table-radio-audio-soundscape's own RETROSPECTIVE.md).
  // layer id -> { el, key }. `key` (started_at|paused_at|loop) identifies
  // which instance-state the element currently reflects, so a snapshot
  // that changes some OTHER layer doesn't cause a redundant reseek of
  // this one -- same discipline as A-Cell's own preview-instance
  // tracking for the main track.
  var ambientAudioEls = {};
  // fired_at -> { el, key }, same shape as ambientAudioEls -- a stinger
  // a Handler has turned into a loop (setStingerLoop_) needs the exact
  // same pause/resume/seek tracking an ambient layer does, addressed by
  // fired_at instead of id since the same stinger id can have several
  // independent instances firing close together.
  var stingerAudioEls = {};
  // Which stinger fired_at values have already been played on THIS
  // client, so a fresh onSnapshot (page load, reconnect, channel
  // re-tune) doesn't replay the last few minutes' worth of one-shot
  // stingers -- only ones fired from here on. A stinger a Handler has
  // explicitly looped is treated as "still on air" regardless (same as
  // an ambient layer would be), not backlog. Reset to null on every
  // (re)tune; applyStingers_'s first call after that seeds it from
  // whatever's already on the doc.
  var seenStingerFires = null;
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

  // Recomputes, from wall-clock "now", how far into the broadcast a
  // channel's current track should be -- shared by renderEmbed() (for
  // both the <audio> seek and YouTube's playerVars.start) and
  // seekAudioToLive_()'s post-interruption reseek below, so both land on
  // the same live position instead of two slightly different formulas.
  function liveElapsedSeconds_(np) {
    var isPaused = !!np.paused;
    var pausedAtMs = np.paused_at || Date.now();
    return isPaused
      ? Math.max(0, Math.floor((pausedAtMs - (np.started_at || pausedAtMs)) / 1000))
      : Math.max(0, Math.floor((Date.now() - (np.started_at || Date.now())) / 1000));
  }

  // Seeks an <audio> element to the live position for the given
  // now-playing doc, THEN invokes `then` (if given) -- calling .play()
  // before metadata has loaded and a later currentTime assignment both
  // "work" individually, but calling play() first turned out to win the
  // race: Chromium (confirmed via a currentTime-setter probe, not just
  // suspected) silently resets the seek back toward 0 once the requested
  // playback actually starts, discarding a currentTime set in between.
  // Routing every play() call through `then` guarantees the seek is
  // fully applied first. Also handles setting .currentTime before the
  // element has loaded enough to know its own duration at all (readyState
  // 0, HAVE_NOTHING) -- deferred until loadedmetadata, since iOS Safari
  // is known to silently drop that assignment rather than queue it.
  function seekAudioToLive_(audioEl, np, then) {
    if (!audioEl || !np) { if (then) then(); return; }
    function apply() {
      try { audioEl.currentTime = liveElapsedSeconds_(np); } catch (e) { /* not seekable yet */ }
      if (then) then();
    }
    if (audioEl.readyState >= 1) { apply(); return; }
    audioEl.addEventListener('loadedmetadata', apply, { once: true });
  }

  function destroyActivePlayers() {
    if (ytPlayer) { try { ytPlayer.destroy(); } catch (e) { /* already gone */ } ytPlayer = null; }
    ytPlayerReady = false;
    scWidget = null; // SC.Widget doesn't need explicit teardown -- its iframe is about to be replaced/removed anyway
    scDuration = null;
    scPosition = 0;
    // Real bug, live-reported: switching Track Library tracks played the
    // old and new mp3 simultaneously, with no way to stop the old one.
    // renderEmbed() replaces #dg-radio-embed-wrap's innerHTML to build
    // the new embed, but a playing HTMLMediaElement does NOT stop just
    // because it's removed from the document -- it keeps decoding and
    // playing, orphaned, until explicitly paused (or eventually GC'd,
    // with no fixed timeline). Once replaced, getElementById('dg-radio-
    // audio') only ever returns the NEW element, so the old one becomes
    // permanently unreachable -- exactly "can't stop the one that was
    // playing before". Must pause() AND clear the src (not just
    // pause()) -- a paused element with a src still loaded can audibly
    // resume if anything ever calls .play() on a stale reference again.
    var oldAudioEl = document.getElementById('dg-radio-audio');
    if (oldAudioEl) {
      try {
        // Set BEFORE pause() -- pausing fires this same element's own
        // 'pause' listener (added in renderEmbed() below), which treats
        // an unprompted pause as a playback interruption to recover
        // from and calls .play() right back on it. intentionalPause is
        // reset to the new track's real state as soon as one exists (see
        // renderEmbed()'s 'audio' branch below), so this is safe to
        // leave set for however long it takes for that to happen.
        intentionalPause = true;
        oldAudioEl.pause();
        oldAudioEl.removeAttribute('src');
        oldAudioEl.load();
      } catch (e) { /* already gone */ }
    }
    currentEmbedKind = null;
  }

  // Same elapsed-time formula as liveElapsedSeconds_(np) above, just
  // generalized to any object carrying started_at/paused/paused_at --
  // an ambient-layer or stinger instance from Code.gs's soundboard
  // actions has the exact same shape as the main Now Playing doc.
  function instanceElapsedSeconds_(inst) {
    var isPaused = !!inst.paused;
    var pausedAtMs = inst.paused_at || Date.now();
    return isPaused
      ? Math.max(0, Math.floor((pausedAtMs - (inst.started_at || pausedAtMs)) / 1000))
      : Math.max(0, Math.floor((Date.now() - (inst.started_at || Date.now())) / 1000));
  }

  // Starts/stops/reseeks <audio> elements to match the channel's active
  // ambient layers exactly -- diffed against ambientAudioEls rather than
  // torn down and rebuilt wholesale on every snapshot, so a layer that
  // was already looping keeps its own playback position instead of
  // restarting every time some OTHER layer or the main track changes.
  // Each active layer is now a full instance object (started_at/paused/
  // paused_at/loop), not a bare id, so a Handler pausing, seeking, or
  // un-looping one specific loop from A-Cell's Active Sounds panel is
  // reflected here exactly the same way the main track's own pause/
  // resume/seek already is -- and Stop (removing it from the array
  // entirely) is unambiguous, unlike a toggle button whose current
  // state is easy to lose track of.
  function applyAmbientLayers_(activeLayers) {
    activeLayers = Array.isArray(activeLayers) ? activeLayers : [];
    var activeIds = activeLayers.map(function (l) { return l.id; });
    Object.keys(ambientAudioEls).forEach(function (id) {
      if (activeIds.indexOf(id) === -1) {
        var entry = ambientAudioEls[id];
        try { entry.el.pause(); entry.el.src = ''; entry.el.remove(); } catch (e) { /* already gone */ }
        delete ambientAudioEls[id];
      }
    });
    activeLayers.forEach(function (layer) {
      var entry = ambientAudioEls[layer.id];
      if (!entry) {
        var el = document.createElement('audio');
        el.src = 'assets/ambient/' + layer.id + '.mp3';
        el.muted = isMuted();
        el.volume = getVolume() / 100;
        el.style.display = 'none';
        document.body.appendChild(el);
        entry = { el: el, key: '' };
        ambientAudioEls[layer.id] = entry;
      }
      entry.el.loop = !!layer.loop;
      var key = layer.started_at + '|' + layer.paused_at + '|' + (layer.loop ? 1 : 0);
      if (entry.key === key) return;
      entry.key = key;
      var applyState = function () {
        try { entry.el.currentTime = instanceElapsedSeconds_(layer); } catch (e) { /* not seekable yet */ }
        if (layer.paused) {
          entry.el.pause();
        } else {
          // Same muted-autoplay-then-unmute-later pattern the main track
          // already relies on -- starting muted (the default until the
          // first Sound tap) always autoplays; a later mute-button tap
          // just flips .muted on an already-playing element.
          var p = entry.el.play();
          if (p && p.catch) p.catch(function () { /* best effort -- ambience is cosmetic, no resume affordance needed */ });
        }
      };
      if (entry.el.readyState >= 1) applyState();
      else entry.el.addEventListener('loadedmetadata', applyState, { once: true });
    });
  }

  // Plays/stops/reseeks stinger instances the same instance-diffing way
  // applyAmbientLayers_ does above -- an ARRAY of recent instances (not
  // a single scalar), so two stingers triggered close together both
  // survive to be played here as separate, naturally overlapping
  // <audio> elements instead of the second clobbering the first. A
  // stinger a Handler turns into a loop (setStingerLoop_) is tracked
  // exactly like an ambient layer from that point on; an ordinary
  // one-shot's own 'ended' event cleans itself up, and reaching the end
  // of the array (removed via stop_stinger, or trimmed out of history)
  // stops it early for every listener, not just this device.
  function applyStingers_(stingers) {
    stingers = Array.isArray(stingers) ? stingers : [];
    var isFirstSnapshot = seenStingerFires === null;
    if (isFirstSnapshot) seenStingerFires = {};

    var activeFiredAts = stingers.map(function (s) { return s.fired_at; });
    Object.keys(stingerAudioEls).forEach(function (firedAtKey) {
      if (activeFiredAts.indexOf(Number(firedAtKey)) === -1) {
        var oldEntry = stingerAudioEls[firedAtKey];
        try { oldEntry.el.pause(); oldEntry.el.src = ''; oldEntry.el.remove(); } catch (e) { /* already gone */ }
        delete stingerAudioEls[firedAtKey];
      }
    });

    stingers.forEach(function (s) {
      var alreadySeen = !!seenStingerFires[s.fired_at];
      seenStingerFires[s.fired_at] = true;
      // A fresh tune-in shouldn't replay the last few minutes' worth of
      // one-shot fires -- but a stinger a Handler has explicitly looped
      // is legitimately still "on air" right now, same as an ambient
      // layer would be, not backlog to skip.
      if (isFirstSnapshot && !s.loop) return;
      // A one-shot stinger this client has already seen, with no
      // currently-playing element for it, already finished naturally
      // (its own 'ended' handler cleaned it up) -- not a signal to
      // start it again from scratch.
      if (!s.loop && alreadySeen && !stingerAudioEls[s.fired_at]) return;

      var entry = stingerAudioEls[s.fired_at];
      if (!entry) {
        var el = document.createElement('audio');
        el.src = 'assets/stingers/' + s.id + '.mp3';
        el.muted = isMuted();
        el.volume = getVolume() / 100;
        el.style.display = 'none';
        document.body.appendChild(el);
        el.addEventListener('ended', function () {
          try { el.remove(); } catch (e) { /* already gone */ }
          delete stingerAudioEls[s.fired_at];
        });
        entry = { el: el, key: '' };
        stingerAudioEls[s.fired_at] = entry;
      }
      entry.el.loop = !!s.loop;
      var key = s.started_at + '|' + s.paused_at + '|' + (s.loop ? 1 : 0);
      if (entry.key === key) return;
      entry.key = key;
      var applyState = function () {
        try { entry.el.currentTime = instanceElapsedSeconds_(s); } catch (e) { /* not seekable yet */ }
        if (s.paused) {
          entry.el.pause();
        } else {
          var p = entry.el.play();
          // A blocked/failed fire just silently doesn't play -- there's
          // no sensible "tap to resume" affordance for a one-shot
          // that's already fired and gone by the time anyone could tap
          // it (a looped one will simply pick up on the next snapshot
          // that actually changes something).
          if (p && p.catch) p.catch(function () {
            try { entry.el.remove(); } catch (e2) { /* already gone */ }
            delete stingerAudioEls[s.fired_at];
          });
        }
      };
      if (entry.el.readyState >= 1) applyState();
      else entry.el.addEventListener('loadedmetadata', applyState, { once: true });
    });
  }

  // Formats a seconds count as m:ss (no leading-zero hours -- nothing in
  // this app plays anything long enough to need them).
  function formatTime_(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Read-only progress display -- deliberately NOT a draggable seek bar.
  // Only the Handler's A-Cell Music tab can scrub (seek_now_playing),
  // keeping every listener's playback provably in sync with the
  // broadcast instead of letting each one drift by scrubbing their own
  // local copy. Pulls elapsed/duration from whichever embed kind is
  // actually live; hides itself entirely for a kind that can't report
  // both (the generic-iframe fallback, or before an API/embed is ready).
  function updateProgressDisplay() {
    var wrap = document.getElementById('dg-radio-progress');
    if (!wrap) return;
    var elapsed = null, duration = null;
    if (currentEmbedKind === 'audio') {
      var audioEl = document.getElementById('dg-radio-audio');
      if (audioEl) {
        elapsed = audioEl.currentTime;
        duration = isFinite(audioEl.duration) ? audioEl.duration : null;
      }
    } else if (currentEmbedKind === 'yt' && ytPlayer && ytPlayerReady) {
      try {
        elapsed = ytPlayer.getCurrentTime();
        duration = ytPlayer.getDuration();
      } catch (e) { /* not ready yet */ }
    } else if (currentEmbedKind === 'sc' && scDuration) {
      elapsed = scPosition / 1000;
      duration = scDuration / 1000;
    }
    if (elapsed === null || !duration) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    var fill = document.getElementById('dg-radio-progress-fill');
    var label = document.getElementById('dg-radio-progress-label');
    var pct = Math.max(0, Math.min(100, (elapsed / duration) * 100));
    if (fill) fill.style.width = pct + '%';
    if (label) label.textContent = formatTime_(elapsed) + ' / ' + formatTime_(duration);
  }

  var progressInterval = null;
  // Only ticks while the panel is actually expanded (the progress row is
  // hidden entirely when minimized) -- no point paying a per-second
  // getCurrentTime()/postMessage round-trip for a display nobody can see.
  function startProgressInterval() {
    stopProgressInterval();
    progressInterval = setInterval(updateProgressDisplay, 1000);
    updateProgressDisplay();
  }
  function stopProgressInterval() {
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
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
    // #dg-radio-prefixed for the same reason as .dgr-turn/.dgr-confirm
    // above -- stats/index.html's Modern theme has a bare "input,
    // textarea" rule (background/border/border-radius/box-shadow) that
    // would otherwise reskin this range slider's track per theme too.
    '#dg-radio .dgr-volume{width:52px;flex-shrink:0;accent-color:#6a9a40;}',
    '#dg-radio-panel:not(.dgr-panel-expanded) .dgr-expand-section{display:none;}',
    '.dgr-expand-section{margin-top:8px;}',
    '#dg-radio-track{font-size:12px;color:#e6ecd8;margin-bottom:4px;overflow-wrap:anywhere;}',
    // Read-only -- see updateProgressDisplay()'s own comment for why
    // this never accepts a click/drag the way a real media player's
    // scrubber would.
    '.dgr-progress{margin:2px 0 8px;}',
    '.dgr-progress-track{width:100%;height:4px;background:#20261a;border-radius:2px;overflow:hidden;}',
    '.dgr-progress-fill{height:100%;background:#8fae5a;width:0%;}',
    '.dgr-progress-label{font-size:9px;color:#7a8a68;margin-top:3px;text-align:right;}',
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
    // #dg-radio-prefixed, not bare .dgr-turn -- same reasoning as
    // .dgr-btn's #dg-radio-panel prefix above: stats/index.html's theme
    // stylesheets each carry their own blanket ".theme-x button" rule
    // (background/border/color reset for every <button> on the page),
    // which at bare-class specificity would otherwise win over this
    // widget's own styling and make the dial's </> buttons quietly
    // reskin per theme instead of keeping one consistent look everywhere.
    '#dg-radio .dgr-turn{',
    'background:#20261a;border:1px solid #3a4432;color:#c9d4b8;border-radius:50%;',
    'width:26px;height:26px;font-size:13px;cursor:pointer;line-height:1;padding:0;}',
    '#dg-radio .dgr-turn:hover{border-color:#5a6a48;}',
    '.dgr-dial-readout{font-size:12px;color:#e6ecd8;min-width:44px;}',
    '.dgr-dial-readout b{color:#a8c890;}',
    '#dg-radio .dgr-confirm{',
    'display:block;width:100%;background:#2a3a1c;color:#d8f0c0;',
    'border:1px solid #4a6a30;border-radius:4px;padding:7px;font-family:inherit;',
    'font-size:11px;letter-spacing:.05em;cursor:pointer;margin-top:2px;}',
    '#dg-radio .dgr-confirm:hover{border-color:#6a9a40;}',
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
      seenStingerFires = null;
      applyAmbientLayers_([]);
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
    if (expanded) startProgressInterval(); else stopProgressInterval();
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
      '<div id="dg-radio-progress" class="dgr-progress" style="display:none;">' +
      '<div class="dgr-progress-track"><div class="dgr-progress-fill" id="dg-radio-progress-fill"></div></div>' +
      '<div class="dgr-progress-label" id="dg-radio-progress-label"></div>' +
      '</div>' +
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
        seenStingerFires = null;
        applyAmbientLayers_([]);
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
      stopProgressInterval();
      clearChannel();
      window._dgRadioLast = null;
      seenStingerFires = null;
      applyAmbientLayers_([]);
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
    // Ambient loops and any looped stinger follow the same mute/volume
    // control as the main track -- there's no separate soundboard
    // volume knob, same reasoning as everything else on this widget
    // sharing one control surface. An ordinary one-shot stinger is
    // over too fast for this to matter, but a looped one can run
    // indefinitely, same as an ambient layer.
    Object.keys(ambientAudioEls).forEach(function (id) {
      ambientAudioEls[id].el.muted = muted;
      ambientAudioEls[id].el.volume = vol / 100;
    });
    Object.keys(stingerAudioEls).forEach(function (firedAt) {
      stingerAudioEls[firedAt].el.muted = muted;
      stingerAudioEls[firedAt].el.volume = vol / 100;
    });
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
        intentionalPause = paused;
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
    var elapsed = liveElapsedSeconds_(np);
    var muted = isMuted();
    var vol = getVolume();
    var loop = !!np.loop;
    // A Track Library pick's download link (Firebase Storage now, or a
    // Drive one for any track uploaded before that migration) has no
    // .mp3 extension for isDirectAudio() to catch -- track_kind says so
    // explicitly instead of relying on the URL shape, and skips the YouTube/
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
          try { scWidget.getDuration(function (ms) { scDuration = ms; }); } catch (e) { /* best effort */ }
        });
        // Pushed by the widget itself every couple hundred ms while
        // playing -- see scDuration/scPosition's own comment above for
        // why this isn't polled the same way <audio>/YouTube are.
        scWidget.bind(window.SC.Widget.Events.PLAY_PROGRESS, function (e) {
          scPosition = e.currentPosition;
        });
      });
    } else if (isLibraryAudio || isDirectAudio(np.track_url)) {
      currentEmbedKind = 'audio';
      intentionalPause = isPaused;
      if (volSlider) volSlider.style.display = '';
      wrap.innerHTML = '<audio id="dg-radio-audio" src="' + escapeHtml(np.track_url) + '"></audio>';
      var audioEl = document.getElementById('dg-radio-audio');
      audioEl.muted = muted;
      audioEl.volume = vol / 100;
      audioEl.loop = loop;
      // A bad/unreachable src (e.g. a broken Drive hotlink) otherwise
      // fails completely silently -- no sound, no visible sign why.
      audioEl.addEventListener('error', function () {
        var statusEl = document.getElementById('dg-radio-status');
        if (statusEl) statusEl.textContent = 'Playback failed -- this track isn\'t reachable right now.';
      });
      // iOS Safari can pause tab-wide <audio> playback on ANY iframe
      // navigation elsewhere on the page -- a known WebKit quirk, not
      // something this element being outside #dg-shell-content protects
      // against, confirmed live: the shell's own single hoisted widget
      // (this element) still stopped and stayed stopped on a content
      // swap. Nothing here ever calls audioEl.pause() except a real
      // Handler-paused broadcast (applyLivePauseState(), which sets
      // intentionalPause first) -- any OTHER 'pause' event is the
      // browser's own doing, so resume immediately rather than leaving
      // the table silently stuck.
      audioEl.addEventListener('pause', function () {
        if (!intentionalPause && !audioEl.ended) {
          // The same WebKit interruption that fires this unprompted
          // pause can also silently evict the element's buffered audio,
          // which resets currentTime back toward 0 once play() actually
          // starts fetching again -- reseek to the CURRENT live position
          // (recomputed from wall-clock, not whatever renderEmbed()
          // computed when the track first loaded) so a resume lands back
          // where the broadcast actually is now, not at the beginning.
          // window._dgRadioLast is the last known now-playing doc; a
          // real Handler pause would have set intentionalPause first, so
          // reaching here with .paused true would be a stale reference,
          // hence the belt-and-suspenders check.
          function resumeAfterInterruption() {
            var p = audioEl.play();
            if (p && p.catch) {
              // Genuinely can't resume without a fresh user gesture --
              // same fallback the initial play() attempt below already
              // offers, not a new failure mode.
              p.catch(function () { resumeBtn.style.display = 'block'; });
            }
          }
          if (window._dgRadioLast && !window._dgRadioLast.paused) {
            seekAudioToLive_(audioEl, window._dgRadioLast, resumeAfterInterruption);
          } else {
            resumeAfterInterruption();
          }
        }
      });
      seekAudioToLive_(audioEl, np, function () {
        if (!isPaused) {
          var playPromise = audioEl.play();
          if (playPromise && playPromise.catch) {
            playPromise.catch(function () { resumeBtn.style.display = 'block'; });
          }
        }
      });
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

  /* ── Firebase Firestore, loaded on demand -- same on-demand-script
     pattern as the YouTube/SoundCloud APIs above, so pages that never
     tune in never pay for it. ── */
  var firebaseApiLoading = false;
  var firebaseApiCallbacks = [];
  function ensureFirebaseApi(cb) {
    if (window.firebase && window.firebase.apps && window.firebase.apps.length) { cb(); return; }
    firebaseApiCallbacks.push(cb);
    if (firebaseApiLoading) return;
    firebaseApiLoading = true;
    var appScript = document.createElement('script');
    appScript.src = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/firebase-app-compat.js';
    appScript.onload = function () {
      var fsScript = document.createElement('script');
      fsScript.src = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/firebase-firestore-compat.js';
      fsScript.onload = function () {
        if (!window.firebase.apps.length) {
          window.firebase.initializeApp(FIREBASE_CONFIG);
          // Brave (and some ad-blocker extensions) silently blocks
          // Firestore's default streaming transport (WebChannel) --
          // it looks like a long-lived tracking connection -- which
          // leaves every onSnapshot() listener permanently stuck with
          // zero data and no error at all. Falls back to plain HTTP
          // long-polling, which isn't blocked. See a-cell.html's own
          // copy of this comment for the full report that traced this
          // down (worked in Safari, silently empty in Brave).
          window.firebase.firestore().settings({ experimentalAutoDetectLongPolling: true });
        }
        var cbs = firebaseApiCallbacks; firebaseApiCallbacks = [];
        cbs.forEach(function (fn) { fn(); });
      };
      document.head.appendChild(fsScript);
    };
    document.head.appendChild(appScript);
  }

  // Given a radio/{channel} Firestore document's data (or null if it
  // doesn't exist / has no track yet), updates every on-screen bit of
  // state -- same logic the old JSONP poll()'s success callback had,
  // just fed by a live snapshot instead of a timed GET. np's field
  // names match getNowPlaying()'s old JSONP response 1:1 (both are
  // ultimately written by the same Code.gs functions -- see the
  // dual-write bridge in setNowPlaying()/pauseNowPlaying()/
  // resumeNowPlaying()), so renderEmbed()/applyLivePauseState() below
  // needed no changes at all for this swap.
  function handleNowPlaying(np) {
    // Ambient loops/stingers are independent of the main track -- applied
    // unconditionally, before the no-track early return below, so a
    // Handler can layer ambience onto a silent channel.
    applyAmbientLayers_(np && np.ambient_layers);
    applyStingers_(np && np.stingers);
    var statusEl = document.getElementById('dg-radio-status');
    var trackEl = document.getElementById('dg-radio-track');
    var miniTrackEl = document.getElementById('dg-radio-mini-track');
    if (!np || !np.track_url) {
      if (statusEl) statusEl.textContent = 'Waiting for the Handler…';
      if (trackEl) trackEl.textContent = 'No signal yet.';
      if (miniTrackEl) miniTrackEl.textContent = 'No signal yet.';
      if (lastStartedAt) { window._dgRadioLast = null; renderEmbed(null); }
      lastStartedAt = null;
      lastPaused = false;
      return;
    }
    var label = np.track_title || np.track_url;
    if (trackEl) trackEl.textContent = label;
    if (miniTrackEl) miniTrackEl.textContent = label;
    if (statusEl) statusEl.textContent = np.paused ? 'Paused by the Handler' : 'On air';
    if (np.started_at !== lastStartedAt) {
      lastStartedAt = np.started_at;
      lastPaused = !!np.paused;
      window._dgRadioLast = np;
      renderEmbed(np);
    } else if (!!np.paused !== lastPaused) {
      // Same track, only the pause state flipped -- toggle the live
      // player in place instead of a full rebuild (which would restart
      // YouTube/SoundCloud from scratch on every Pause/Resume click).
      lastPaused = !!np.paused;
      window._dgRadioLast = np;
      if (!applyLivePauseState(lastPaused)) renderEmbed(np);
    }
  }

  var radioUnsubscribe = null;
  function startPolling() {
    stopPolling();
    var ch = getChannel();
    if (!ch) return;
    ensureFirebaseApi(function () {
      // The channel may have changed (or Leave may have cleared it)
      // while the SDK was still loading -- don't subscribe to a
      // now-stale channel.
      if (getChannel() !== ch) return;
      var docRef = window.firebase.firestore().collection('radio').doc(ch);
      radioUnsubscribe = docRef.onSnapshot(function (snap) {
        handleNowPlaying(snap.exists ? snap.data() : null);
      }, function (err) {
        // Same tolerance the old poll() had for a transient miss -- log
        // it and leave whatever was last known on screen; Firestore's
        // own client handles reconnect/retry, no manual re-poll needed.
        console.error('Table Radio listener error:', err);
      });
    });
  }
  function stopPolling() {
    if (radioUnsubscribe) { radioUnsubscribe(); radioUnsubscribe = null; }
  }

  if (getChannel()) {
    renderTuned();
    startPolling();
  } else {
    renderCollapsed();
  }
})();
