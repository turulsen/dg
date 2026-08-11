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
   for Cloud Save's eventually-consistent character sync.

   Requires the set_now_playing / get_now_playing Apps Script actions
   (see acell-table-radio-addition.txt, handed over separately -- not
   yet deployed on the live backend until pasted in and redeployed).

   Deliberately styled as its own self-contained floating "device"
   (dark, amber/green field-radio look) rather than trying to match
   each page's own theme -- this page loads on the dark folder-look
   Hub pages AND stats/index.html's six very different themes, and a
   fixed prop identity reads better everywhere than chasing six
   palettes.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";
  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';
  var CHANNEL_KEY = 'dg_radio_channel';
  var MUTED_KEY = 'dg_radio_muted';
  var POLL_MS = 6000;
  // Fixed numbered channels, picked by turning a dial rather than typing a
  // name -- five slots, no typos, no two players landing on "sam" vs "Sam".
  var CHANNELS = ['1', '2', '3', '4', '5'];

  var lastStartedAt = null;
  var pollTimer = null;

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

  function extractYouTubeId(url) {
    var m = (url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
    return m ? m[1] : null;
  }
  function isSoundCloud(url) { return /soundcloud\.com/i.test(url || ''); }
  function isDirectAudio(url) { return /\.(mp3|wav|ogg|m4a)(\?|#|$)/i.test((url || '').split(/[?#]/)[0]); }

  /* ── DOM / styles ── */
  var style = document.createElement('style');
  style.textContent = [
    '#dg-radio{position:fixed;right:14px;bottom:14px;z-index:9998;',
    'font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;',
    'max-width:min(320px,calc(100vw - 28px));}',
    '#dg-radio-pill{',
    'background:#161a14;color:#c9d4b8;border:1px solid #3a4432;border-radius:20px;',
    'padding:8px 14px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4);',
    'display:flex;align-items:center;gap:8px;user-select:none;}',
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
    'font-family:inherit;font-size:11px;padding:3px 7px;cursor:pointer;}',
    '#dg-radio-panel .dgr-btn:hover{border-color:#5a6a48;}',
    '#dg-radio-track{font-size:12px;color:#e6ecd8;margin-bottom:4px;overflow-wrap:anywhere;}',
    '#dg-radio-status{font-size:10px;color:#7a8a68;margin-bottom:8px;}',
    '#dg-radio-resume{',
    'display:none;width:100%;margin-top:6px;background:#2a3a1c;color:#d8f0c0;',
    'border:1px solid #4a6a30;border-radius:4px;padding:6px;font-family:inherit;',
    'font-size:11px;letter-spacing:.05em;cursor:pointer;}',
    '#dg-radio-embed-wrap{display:none;margin-top:6px;}',
    '#dg-radio-embed-wrap iframe, #dg-radio-embed-wrap audio{width:100%;border:0;border-radius:4px;}',
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
    root.innerHTML = '<div id="dg-radio-pill">Tune In</div>';
    document.getElementById('dg-radio-pill').addEventListener('click', renderChoosing);
  }

  function renderChoosing() {
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

  function renderTuned() {
    var ch = getChannel();
    root.innerHTML =
      '<div id="dg-radio-panel">' +
      '<div class="dgr-head"><span><b id="dg-radio-ch-label">CH ' + escapeHtml(ch) + '</b></span>' +
      '<span><button type="button" class="dgr-btn" id="dg-radio-mute">' + (isMuted() ? 'MUTED' : 'SOUND') + '</button> ' +
      '<button type="button" class="dgr-btn" id="dg-radio-change">Channel</button> ' +
      '<button type="button" class="dgr-btn" id="dg-radio-leave">X</button></span></div>' +
      '<div id="dg-radio-dial-slot"></div>' +
      '<div id="dg-radio-track">No signal yet.</div>' +
      '<div id="dg-radio-status">Waiting for the Handler…</div>' +
      '<button type="button" id="dg-radio-resume">Tap to resume audio</button>' +
      '<div id="dg-radio-embed-wrap"></div>' +
      '</div>';

    document.getElementById('dg-radio-mute').addEventListener('click', function () {
      setMuted(!isMuted());
      renderEmbed(window._dgRadioLast);
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
        document.getElementById('dg-radio-status').textContent = 'Waiting for the Handler…';
        renderEmbed(null);
        startPolling();
      });
    });
    document.getElementById('dg-radio-leave').addEventListener('click', function () {
      stopPolling();
      clearChannel();
      window._dgRadioLast = null;
      renderCollapsed();
    });
    document.getElementById('dg-radio-resume').addEventListener('click', function () {
      setMuted(false);
      renderEmbed(window._dgRadioLast);
    });
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  }

  function renderEmbed(np) {
    var wrap = document.getElementById('dg-radio-embed-wrap');
    var resumeBtn = document.getElementById('dg-radio-resume');
    var muteBtn = document.getElementById('dg-radio-mute');
    if (!wrap) return; // panel not on screen (e.g. collapsed)
    if (muteBtn) muteBtn.textContent = isMuted() ? 'MUTED' : 'SOUND';

    if (!np || !np.track_url) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      resumeBtn.style.display = 'none';
      return;
    }

    var elapsed = Math.max(0, Math.floor((Date.now() - (np.started_at || Date.now())) / 1000));
    var muted = isMuted();
    var ytId = extractYouTubeId(np.track_url);
    var html;
    if (ytId) {
      html = '<iframe height="70" src="https://www.youtube.com/embed/' + ytId +
        '?autoplay=1&start=' + elapsed + '&mute=' + (muted ? 1 : 0) +
        '" allow="autoplay" title="Table Radio"></iframe>';
    } else if (isSoundCloud(np.track_url)) {
      html = '<iframe height="80" src="https://w.soundcloud.com/player/?url=' + encodeURIComponent(np.track_url) +
        '&auto_play=true' + '" allow="autoplay" title="Table Radio"></iframe>';
    } else if (isDirectAudio(np.track_url)) {
      html = '<audio id="dg-radio-audio" src="' + escapeHtml(np.track_url) + '" autoplay' + (muted ? ' muted' : '') + '></audio>';
    } else {
      html = '<iframe height="70" src="' + escapeHtml(np.track_url) + '" allow="autoplay" title="Table Radio"></iframe>';
    }
    wrap.innerHTML = html;
    wrap.style.display = 'block';

    var audioEl = document.getElementById('dg-radio-audio');
    if (audioEl) {
      audioEl.currentTime = elapsed;
      var playPromise = audioEl.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () { resumeBtn.style.display = 'block'; });
      }
    } else {
      // Can't detect YouTube/SoundCloud iframe playback failures directly
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
      if (!res || res.status !== 'OK' || !res.track_url) {
        if (statusEl) statusEl.textContent = 'Waiting for the Handler…';
        if (trackEl) trackEl.textContent = 'No signal yet.';
        if (lastStartedAt) { window._dgRadioLast = null; renderEmbed(null); }
        lastStartedAt = null;
        return;
      }
      if (trackEl) trackEl.textContent = res.track_title || res.track_url;
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
