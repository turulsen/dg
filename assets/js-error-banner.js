/* ══════════════════════════════════════════════
   Page-wide uncaught-error/unhandled-rejection catcher.

   Originally a-cell.html-only (added after several rounds of narrow,
   targeted fixes to Evidence's own sign-in pipeline, each individually
   verified correct, yet a live device stayed stuck showing nothing new
   after every one of them -- a strong signal that something ELSE,
   outside every path checked so far, might be the actual blocker. With
   no devtools access on the reporting device, an on-screen banner with
   the real error message/stack was the one tool that could reveal a
   completely different, unanticipated failure instead of guessing at
   more variations on the same already-checked pipeline).

   Generalized to every page and given a persistent backend log after
   the 2026-09-10 incident: live players reported the app broken in
   several different ways across several different pages at once, but
   the only on-screen error visibility that existed anywhere was this
   banner, and only on a-cell.html -- every other page's failures were
   completely invisible unless someone happened to have devtools open
   at the exact moment. The banner alone only helps if someone is
   physically watching that one screen when it happens; this also
   POSTs a best-effort report to the Apps Script backend (log_client_error,
   see backend/Code.gs), a plain fire-and-forget fetch with no Firebase
   dependency at all -- deliberately so a failure IN Firebase loading
   itself still gets reported, rather than the one thing most likely to
   break also being the one channel that can't report it breaking.

   Deliberately the very first script tag on every page, before
   anything else runs, so it can catch a crash from ANY later script on
   that page, not just one widget's own pipeline. ══════════════════════ */
(function () {
  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';
  // One id per page load, sent with every report, so a burst of
  // errors from the same load can be told apart from unrelated ones
  // across devices/sessions when reading the ClientErrors sheet later.
  var SESSION_ID = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  // Hard caps against exactly the "same error flooding every couple
  // seconds" shape the 2026-09-10 incident showed -- without these, a
  // tight retry loop hitting the same throw would paint an
  // ever-growing banner and hammer the backend with duplicate rows
  // instead of surfacing one clear signal.
  var MAX_REPORTS_TOTAL = 25;
  var MAX_REPEATS_PER_KEY = 3;
  var totalReports = 0;
  var seenCounts = {};

  function showJsErrorBanner(label, detail) {
    var id = 'dg-jserror-banner';
    var bar = document.getElementById(id);
    if (!bar) {
      bar = document.createElement('div');
      bar.id = id;
      Object.assign(bar.style, {
        position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '999999',
        maxHeight: '40vh', overflowY: 'auto',
        padding: '10px 14px', background: '#3a0f0f', color: '#f5d0d0',
        borderTop: '2px solid #a33', fontFamily: "'Courier Prime', monospace",
        fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        boxShadow: '0 -2px 10px rgba(0,0,0,.5)'
      });
      var dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = 'Dismiss all JS error banners';
      Object.assign(dismiss.style, {
        display: 'block', marginBottom: '8px', background: '#5a1a1a', color: '#f5d0d0',
        border: '1px solid #a33', padding: '4px 10px', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 'inherit'
      });
      dismiss.addEventListener('click', function () { bar.remove(); });
      bar.appendChild(dismiss);
      (document.body || document.documentElement).appendChild(bar);
    }
    var line = document.createElement('div');
    line.style.marginBottom = '6px';
    line.style.borderBottom = '1px dotted #a33';
    line.style.paddingBottom = '6px';
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + label + ': ' + detail;
    bar.appendChild(line);
  }

  // Best-effort only -- whatever this page's own widgets have already
  // resolved as "the current Agent," read the same way dice-roller.js's
  // currentAgentCode() does (direct Cloud Save code first, falling back
  // to the roster's most-recently-active entry). Never lets a storage
  // failure here block reporting the actual error.
  function bestEffortAgentCode() {
    try {
      var direct = localStorage.getItem('dg_stats_cloud_code');
      if (direct) return direct;
    } catch (e) { /* best effort */ }
    try {
      var roster = JSON.parse(localStorage.getItem('dg_agent_roster') || '{}');
      var agents = Object.keys(roster).map(function (k) { return roster[k]; })
        .sort(function (a, b) { return (b.saved_at || 0) - (a.saved_at || 0); });
      return (agents[0] && agents[0].code) || '';
    } catch (e) { return ''; }
  }

  function reportToBackend(kind, message, filename, lineno, colno, stack) {
    if (totalReports >= MAX_REPORTS_TOTAL) return;
    totalReports++;
    try {
      var payload = {
        action: 'log_client_error',
        session_id: SESSION_ID,
        kind: kind,
        message: String(message || '').slice(0, 2000),
        filename: filename || '',
        lineno: lineno || 0,
        colno: colno || 0,
        stack: String(stack || '').slice(0, 4000),
        page: location.pathname + location.search,
        agent_code: bestEffortAgentCode(),
        user_agent: navigator.userAgent,
        client_time: new Date().toISOString()
      };
      fetch(APPS_SCRIPT_URL, {
        method: 'POST', mode: 'no-cors',
        body: JSON.stringify(payload)
      }).catch(function () { /* best effort -- never let a failed report throw */ });
    } catch (e) { /* best effort */ }
  }

  function handle(kind, message, filename, lineno, colno, stack) {
    var key = kind + '|' + message + '|' + filename + '|' + lineno;
    var count = (seenCounts[key] = (seenCounts[key] || 0) + 1);
    if (count > MAX_REPEATS_PER_KEY) return; // same error already shown/reported enough times
    var label = kind === 'error' ? 'JS error' : 'Unhandled promise rejection';
    var detail = message + (filename ? ' (' + filename + ':' + lineno + ')' : '');
    if (count === MAX_REPEATS_PER_KEY) detail += ' [repeating -- further copies of this one suppressed]';
    showJsErrorBanner(label, detail);
    reportToBackend(kind, message, filename, lineno, colno, stack);
  }

  window.addEventListener('error', function (e) {
    handle('error', e.message || 'unknown', e.filename, e.lineno, e.colno, e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    handle('rejection', (r && (r.message || String(r))) || 'unknown', '', 0, 0, r && r.stack);
  });
})();
