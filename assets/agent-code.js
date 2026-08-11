/* ══════════════════════════════════════════════
   Shared Agent Code generator -- PREFIX-XXXX, e.g. PATR-EQ9A.
   Used wherever a fresh code needs to be minted: dg-agent-portal.html's
   Cover form, stats/cloud-sync.js's Cloud Save, and
   stats/agent-portal-export.js's fallback. Was three independently-
   maintained copies of the same algorithm before this file existed --
   one drifted (dg-agent-portal.html's was missing the empty-prefix
   fallback below), which is exactly the kind of silent divergence a
   single shared source rules out going forward.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";
  function gen(name) {
    const prefix = (name || 'AGNT').replace(/[^A-Za-z]/g, '').substring(0, 4).toUpperCase() || 'AGNT';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return prefix + '-' + s;
  }
  window.dgAgentCode = { gen };
})();
