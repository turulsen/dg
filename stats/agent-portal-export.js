/* ══════════════════════════════════════════════
   AGENT PORTAL EXPORT (this hub's addition, not part of the upstream
   character creator)

   Sends this character to the Agent Portal as a new Agent File, using
   the exact same submission path the Cover form's own "Submit Brief"
   button uses (same APPS_SCRIPT_URL, same field names, same PREFIX-XXXX
   code format from genCode()) -- not a new backend integration, just
   this page filling out that same form programmatically.

   Name, sex, nationality, and profession carry straight over; build
   (from STR/CON) and outfit (from profession) are derived. Everything
   else about physical appearance is left blank for the Cover tab, same
   as any new agent -- build and outfit already feed the Agent Portal's
   "Field Portrait Prompt" generator on their own, so this is enough for
   strength and profession to quietly shape the portrait prompt too.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';

  // jacket / shirt / trousers / footwear per profession -- plausible
  // defaults, not canon; the Cover tab remains fully editable afterward.
  const PROFESSION_OUTFIT = {
    anthropologist: { jacket: 'tweed blazer with elbow patches', shirt: 'oxford button-down', trousers: 'khaki trousers', footwear: 'worn field boots' },
    federal_agent: { jacket: 'dark suit jacket', shirt: 'white dress shirt', trousers: 'dark slacks', footwear: 'polished oxfords' },
    physician: { jacket: 'white lab coat', shirt: 'scrub top', trousers: 'dress trousers', footwear: 'clogs' },
    computer_scientist: { jacket: 'zip-up hoodie', shirt: 'graphic t-shirt', trousers: 'jeans', footwear: 'sneakers' },
    scientist: { jacket: 'lab coat', shirt: 'button-down shirt', trousers: 'khakis', footwear: 'closed-toe shoes' },
    special_operator: { jacket: 'tactical jacket', shirt: 'moisture-wicking shirt', trousers: 'tactical pants', footwear: 'combat boots' },
    criminal: { jacket: 'worn leather jacket', shirt: 'plain t-shirt', trousers: 'dark jeans', footwear: 'worn sneakers' },
    firefighter: { jacket: 'turnout coat', shirt: 'department t-shirt', trousers: 'uniform trousers', footwear: 'station boots' },
    police_officer: { jacket: 'patrol jacket', shirt: 'uniform shirt', trousers: 'duty trousers', footwear: 'patrol boots' },
    soldier_marine: { jacket: 'combat jacket', shirt: 'OD green t-shirt', trousers: 'camouflage fatigues', footwear: 'combat boots' },
    foreign_service: { jacket: 'suit jacket', shirt: 'dress shirt', trousers: 'pressed trousers', footwear: 'oxford shoes' },
    intelligence_analyst: { jacket: 'blazer', shirt: 'button-down shirt', trousers: 'slacks', footwear: 'loafers' },
    intelligence_case_officer: { jacket: 'unremarkable jacket', shirt: 'plain shirt', trousers: 'neutral-colored trousers', footwear: 'nondescript shoes' },
    lawyer_executive: { jacket: 'tailored suit jacket', shirt: 'dress shirt', trousers: 'suit trousers', footwear: 'polished dress shoes' },
    media_specialist: { jacket: 'casual blazer', shirt: 'collared shirt', trousers: 'jeans', footwear: 'ankle boots' },
    nurse_paramedic: { jacket: 'scrub jacket', shirt: 'scrub top', trousers: 'scrub pants', footwear: 'non-slip shoes' },
    pilot_sailor: { jacket: 'flight/deck jacket', shirt: 'uniform shirt', trousers: 'uniform trousers', footwear: 'deck shoes' },
    program_manager: { jacket: 'business casual blazer', shirt: 'dress shirt', trousers: 'slacks', footwear: 'dress shoes' },
  };

  // csStats keys are uppercase (STR/CON/DEX/INT/POW/CHA) -- see STATS in
  // save-load.js. Reuses the same STR+CON build-tier logic and word pools
  // the built-in Random Bio feature uses (bioData.buildDescriptors in
  // bio.js), rather than inventing separate wording of our own.
  function buildFromStats(csStats) {
    const str = csStats?.STR ?? 10;
    const con = csStats?.CON ?? 10;
    const combined = str + con;
    let tier;
    if (combined >= 36) tier = 'high';
    else if (combined >= 28) tier = 'athletic';
    else if (combined >= 22) tier = 'average';
    else tier = 'low';
    const pool = (typeof bioData !== 'undefined') && bioData.buildDescriptors && bioData.buildDescriptors[tier];
    if (pool && pool.length) return pool[Math.floor(Math.random() * pool.length)];
    // Fallback if bio.js isn't loaded for some reason
    return { high: 'powerfully built', athletic: 'athletic build', average: 'average build', low: 'lean build' }[tier];
  }

  function ageToRange(ageStr) {
    const age = parseInt(ageStr);
    if (!age || isNaN(age)) return '';
    if (age < 20) return 'Early 20s';
    if (age <= 23) return 'Early 20s';
    if (age <= 26) return 'Mid 20s';
    if (age <= 29) return 'Late 20s';
    if (age <= 33) return 'Early 30s';
    if (age <= 36) return 'Mid 30s';
    if (age <= 39) return 'Late 30s';
    if (age <= 43) return 'Early 40s';
    if (age <= 46) return 'Mid 40s';
    if (age <= 49) return 'Late 40s';
    if (age <= 53) return 'Early 50s';
    if (age <= 56) return 'Mid 50s';
    if (age <= 59) return 'Late 50s';
    return '60s or older';
  }

  // cs-bio-sex is free text, not an enum -- Random Bio writes "Male" /
  // "Female" / "Non-binary" (see genderToSex in scripts.js), but a player
  // can type anything. Agent Portal's Sex select only offers Male/Female/
  // Other, so match case-insensitively and fall back to Other/blank.
  function sexToOption(sex) {
    const s = (sex || '').trim().toLowerCase();
    if (!s) return '';
    if (s === 'male' || s === 'm') return 'Male';
    if (s === 'female' || s === 'f') return 'Female';
    return 'Other';
  }

  function genCode(name) {
    const prefix = (name || 'AGNT').replace(/[^A-Za-z]/g, '').substring(0, 4).toUpperCase() || 'AGNT';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return prefix + '-' + s;
  }

  function skillLine(state) {
    const parts = [];
    Object.entries(state.skills || {}).forEach(([key, val]) => {
      if (val > 0) parts.push(`${key}: ${val}%`);
    });
    (state.customSkills || []).forEach(s => { if (s.name && s.value > 0) parts.push(`${s.name}: ${s.value}%`); });
    return parts.join(', ') || '(none set)';
  }

  function buildNotes(state) {
    const s = state.csStats || {};
    const d = state.derived || {};
    const profTitle = (typeof professions !== 'undefined' && professions[state.bio?.profession]?.title) || state.bio?.profession || '—';
    const equipment = (state.equipment || []).map(e => typeof e === 'string' ? e : e.name).join(', ') || '(none)';
    const bonds = (state.bonds || []).map(b => `${b.name || b.relationship || 'Bond'} (${b.score ?? '?'})`).join(', ') || '(none)';
    return [
      `Exported from Character Creator (stats/):`,
      `Profession: ${profTitle}`,
      `STR ${s.STR} CON ${s.CON} DEX ${s.DEX} INT ${s.INT} POW ${s.POW} CHA ${s.CHA}`,
      `HP ${d.hp}  WP ${d.wp}  SAN ${d.san}  BP ${d.bp}`,
      `Skills: ${skillLine(state)}`,
      `Bonds: ${bonds}`,
      `Equipment: ${equipment}`,
    ].join('\n');
  }

  function run() {
    const status = document.getElementById('agent-file-export-status');
    const btn = document.getElementById('export-agent-file-btn');
    if (!window.dgSaveLoad) {
      if (status) status.textContent = 'Save/load module not ready -- try again in a moment.';
      return;
    }
    const state = window.dgSaveLoad.collectState();
    const name = (state.bio?.name || '').trim();
    if (!name || name === 'Agent') {
      if (status) { status.textContent = 'Enter a name in Biography first.'; status.style.color = '#a03030'; }
      return;
    }

    const outfit = PROFESSION_OUTFIT[state.bio?.profession] || {};
    const profTitle = (typeof professions !== 'undefined' && professions[state.bio?.profession]?.title) || state.bio?.profession || '';
    const payload = {
      char_name: name,
      age_range: ageToRange(state.bio?.age),
      sex: sexToOption(state.bio?.sex),
      nationality: state.bio?.nationality || '',
      profession: profTitle,
      build: buildFromStats(state.csStats),
      jacket: outfit.jacket || '',
      shirt: outfit.shirt || '',
      trousers: outfit.trousers || '',
      footwear: outfit.footwear || '',
      notes: buildNotes(state),
      submitted_at: new Date().toISOString(),
    };
    const agentCode = genCode(payload.char_name);
    payload.agent_code = agentCode;

    if (btn) { btn.disabled = true; }
    if (status) { status.textContent = 'Sending…'; status.style.color = ''; }

    try {
      localStorage.setItem('dg_last_agent', JSON.stringify({ code: agentCode, data: payload }));
    } catch (e) { /* best effort */ }

    fetch(APPS_SCRIPT_URL, {
      method: 'POST', mode: 'no-cors', keepalive: true,
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    }).then(() => {
      if (btn) { btn.disabled = false; }
      if (status) {
        status.innerHTML = `Sent. Agent File code: <strong>${agentCode}</strong> — ` +
          `<a href="../dg-agent-portal.html" target="_blank" rel="noopener">open Agent Portal &rarr;</a>`;
        status.style.color = '#2d6a2d';
      }
    }).catch(() => {
      if (btn) { btn.disabled = false; }
      if (status) { status.textContent = 'Connection error -- try again.'; status.style.color = '#a03030'; }
    });
  }

  // Nav shortcut above the theme selector: export (best effort -- run()
  // silently no-ops if there's no name yet) then jump straight to the
  // Agent Portal's Agent File tab. The localStorage write in run() happens
  // synchronously before its fetch, and that fetch is keepalive:true, so
  // navigating away immediately doesn't lose either.
  function goToAgentFile() {
    try { run(); } catch (e) { /* best effort -- still navigate below */ }
    window.location.href = '../dg-agent-portal.html#agent';
  }

  window.dgAgentPortalExport = { run, goToAgentFile, buildFromStats, ageToRange, sexToOption, buildNotes, genCode, PROFESSION_OUTFIT };
  window.dgGoToAgentFile = goToAgentFile;
})();
