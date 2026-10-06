/* ══════════════════════════════════════════════
   THE AGENT FILE, inside Agent Hub (assets/agent-file.css alongside).

   What used to be the Agent Portal's Profiling and Agent File tabs,
   now one file in each Agent's Agent Hub tab: Appearance (the Profiling
   brief -- open, with what's still missing, until it's complete; then
   folded with an Edit button) and the era photos (Face and Outfit
   Plates per era, made from that brief). The Field ID Fabricator, the
   third tab, lives in the Field Notes notebook (field-id.html).

   There is ONE file on the page; Agent Hub moves it into whichever
   Agent's tab is open and loads that Agent:
     dgAgentFile.mount(slotEl, code)   show + load this Agent here
     dgAgentFile.park()                lift it out while the hub rebuilds
     dgAgentFile.focus('appearance'|'photos')
   and fires 'dg-agent-file-saved' {code} on window after a save, so the
   hub can refresh that Agent's name, line and photo.

   The functions below are the portal's own, moved as they were (same
   names, same element ids, same Firestore writes through dg-store.js);
   only loading, saving under the open Agent's code and the tab plumbing
   changed (see "AGENT HUB" at the end).
   ══════════════════════════════════════════════ */
(function () {
  var holder = document.createElement('div');
  holder.id = 'af-holder';
  holder.hidden = true;
  holder.innerHTML = `<div class="af-root" id="af-root">
<div class="af-hidden-plumbing" hidden><div id="af-gate"></div><input id="af-code-input"><div id="af-gate-status"></div><input id="agent-code-input"><div id="dossier-wrap"></div><div id="roster-list"></div></div>
<section class="af-appear" id="af-appear">
  <div class="af-block-head"><span class="af-block-title">Appearance</span><span class="af-appear-state" id="af-appear-state"></span><button type="button" class="af-appear-toggle" id="af-appear-toggle"></button></div>
  <div class="af-appear-note" id="code-load-status"></div>
  <div class="af-appear-body" id="form-paper">
            <div class="section-head" style="margin-top:var(--s4);">Random Agent Generator</div>
            <div style="display:flex;gap:var(--s2);align-items:center;margin-bottom:var(--s4);flex-wrap:wrap;">
              <select class="rand-select fi" id="rand-profession" style="flex:1;min-width:140px;">
                <option value="">Any profession</option>
              </select>
              <button class="submit-btn" style="margin-top:0;padding:7px 16px;font-size:9px;" onclick="randomizeAgent(document.getElementById('rand-profession').value||null)">Generate</button>
              <button class="submit-btn" id="rand-reroll-btn" style="display:none;margin-top:0;padding:7px 16px;font-size:9px;background:rgba(40,28,8,.6);" onclick="rerollAgent()">Re-roll</button>
            </div>
            <div id="rand-result-bar" style="display:none;margin-bottom:var(--s3);">
              <span style="font-family:'Courier Prime',monospace;font-size:10px;color:var(--green-stamp);font-style:italic;">Form filled — review and submit when ready.</span>
            </div>

            <form id="dg-form" onsubmit="return false;">

              <div class="section-head">Identity</div>
              <div class="two">
                <div class="fg"><label>Character name</label><input type="text" name="char_name" class="fi" placeholder="Full name" required></div>
                <div class="fg"><label>Codename <span class="opt">(if any)</span></label><input type="text" name="codename" class="fi" placeholder="—"></div>
              </div>
              <div class="fg"><label>Your Name <span class="opt">(Cover Identity — lets you pull this Agent up on any device later)</span></label><input type="text" name="player_name" class="fi" placeholder="Your own real name, or whatever your Handler knows you by"></div>
              <div class="two">
                <div class="fg"><label>Age range</label>
                  <select name="age_range" class="fs" required>
                    <option value="" disabled selected>Select</option>
                    <option>Early 20s</option><option>Mid 20s</option><option>Late 20s</option>
                    <option>Early 30s</option><option>Mid 30s</option><option>Late 30s</option>
                    <option>Early 40s</option><option>Mid 40s</option><option>Late 40s</option>
                    <option>Early 50s</option><option>Mid 50s</option><option>Late 50s</option>
                    <option>60s or older</option>
                  </select>
                </div>
                <div class="fg"><label>Sex</label>
                  <select name="sex" class="fs" required>
                    <option value="" disabled selected>Select</option>
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>
              </div>
              <div class="fg"><label>Nationality / ethnic background</label><input type="text" name="nationality" class="fi" placeholder="e.g. White American, Nigerian-British" required></div>

              <div class="section-head">Face</div>
              <div class="fg"><label>Face shape</label><input type="text" name="face_shape" class="fi" placeholder="e.g. sharp and angular, round, gaunt" required></div>
              <div class="two">
                <div class="fg"><label>Eye color</label><input type="text" name="eye_color" class="fi" placeholder="e.g. pale blue, dark brown" required></div>
                <div class="fg"><label>Eye shape</label><input type="text" name="eye_shape" class="fi" placeholder="e.g. deep-set, hooded, wide" required></div>
              </div>
              <div class="two">
                <div class="fg"><label>Nose</label><input type="text" name="nose" class="fi" placeholder="e.g. straight, crooked, flat" required></div>
                <div class="fg"><label>Lips</label><input type="text" name="lips" class="fi" placeholder="e.g. thin, full, downturned" required></div>
              </div>
              <div class="fg"><label>Skin tone</label><input type="text" name="skin" class="fi" placeholder="e.g. pale and weathered, warm brown, ruddy" required></div>
              <div class="fg"><label>Facial hair</label><input type="text" name="facial_hair" class="fi" placeholder="e.g. clean-shaven, handlebar moustache, heavy stubble" required></div>
              <div class="fg"><label>Scars / marks <span class="opt">(optional)</span></label><input type="text" name="face_scars" class="fi" placeholder="e.g. scar through left eyebrow, burn scarring on jaw"></div>

              <div class="section-head">Hair</div>
              <div class="fg"><label>Color — be specific</label><input type="text" name="hair_color" class="fi" placeholder="e.g. dirty blond with gray at temples, jet black" required></div>
              <div class="two">
                <div class="fg"><label>Length and style</label><input type="text" name="hair_style" class="fi" placeholder="e.g. shoulder-length worn loose" required></div>
                <div class="fg"><label>Texture</label><input type="text" name="hair_texture" class="fi" placeholder="e.g. straight, wavy, coarse and curly" required></div>
              </div>

              <div class="section-head">Body</div>
              <div class="fg"><label>Build</label><input type="text" name="build" class="fi" placeholder="e.g. lean and wiry, broad-shouldered with a paunch" required></div>
              <div class="fg"><label>Posture</label><input type="text" name="posture" class="fi" placeholder="e.g. coiled and watchful, upright and confident" required></div>
              <div class="fg"><label>Body markers <span class="opt">(optional)</span></label><input type="text" name="body_markers" class="fi" placeholder="e.g. sleeve tattoos, burn scarring on forearms"></div>

              <div class="section-head">Outfit</div>
              <div class="two">
                <div class="fg"><label>Jacket / outerwear</label><input type="text" name="jacket" class="fi" placeholder="e.g. long dark leather jacket" required></div>
                <div class="fg"><label>Shirt / top</label><input type="text" name="shirt" class="fi" placeholder="e.g. black crew-neck t-shirt" required></div>
              </div>
              <div class="two">
                <div class="fg"><label>Trousers</label><input type="text" name="trousers" class="fi" placeholder="e.g. dark indigo jeans" required></div>
                <div class="fg"><label>Footwear</label><input type="text" name="footwear" class="fi" placeholder="e.g. worn western boots" required></div>
              </div>
              <div class="fg"><label>Accessories <span class="opt">(optional)</span></label><input type="text" name="accessories" class="fi" placeholder="e.g. wide western belt with silver buckle, shoulder holster"></div>
              <div class="fg"><label>Jewelry <span class="opt">(optional)</span></label><input type="text" name="jewelry" class="fi" placeholder="e.g. large gold cross pendant, dog tags"></div>

              <div class="section-head">Vibe</div>
              <div class="fg"><label>Default expression</label><input type="text" name="expression" class="fi" placeholder="e.g. flat and dead-eyed, quietly amused" required></div>
              <div class="fg"><label>What does this person feel like to be in a room with?</label><textarea name="vibe" class="ft" placeholder="One or two sentences." required></textarea></div>
              <div class="fg"><label>Resembles <span class="opt">(optional)</span></label><input type="text" name="reference_person" class="fi" placeholder="e.g. early Kris Kristofferson, Nick Nolte"></div>
              <div class="fg"><label>Handler notes <span class="opt">(optional)</span></label><textarea name="notes" class="ft" placeholder="Anything that doesn't fit above."></textarea></div>

              <div class="section-head">Reference Image <span style="font-family:'Source Sans 3';font-weight:300;text-transform:none;letter-spacing:0;color:var(--ink-3);font-size:9px;">(optional)</span></div>
              <div class="upload-zone" onclick="document.getElementById('ref-img').click()">
                <input type="file" id="ref-img" name="ref_image" accept="image/jpeg,image/png,image/webp">
                <div class="upload-hint">Tap to upload reference — JPG, PNG or WebP</div>
                <img id="upload-prev" class="upload-prev">
              </div>

              <div class="submit-row">
                <button type="submit" class="submit-btn" id="submit-btn" onclick="handleSubmit()">Submit Brief</button>
                <span id="form-status"></span>
              </div>
            </form>
  </div>
</section>
<section class="af-photos" id="af-photos">
  <div class="af-block-head"><span class="af-block-title">Era Photos</span></div>
  <p class="af-photos-locked" id="af-photos-locked">Finish the Appearance brief above to make this Agent's photos.</p>
      <div id="af-content" style="display:none;">

        <!-- Header strip -->
        <div class="af-header">
          <div>
            <div class="af-header-label">Asset File</div>
            <div class="af-header-name" id="af-agent-name">—</div>
            <div class="af-header-code" id="af-agent-code">—</div>
            <div class="stamps"><span class="stamp" id="af-kia-stamp" style="display:none;">KIA</span></div>
          </div>
        </div>

        <!-- Vitals + Bonds -- the same scores A-Cell's Handler-only Play
             view already shows (HP/WP/SAN/BP, Bond scores), surfaced here
             too so a player can see them without a Handler. Populated by
             checkAgentKia()'s existing load_character fetch -- best-effort,
             same graceful-degradation as the KIA stamp above (hidden if
             no cloud character exists yet or the backend's unreachable). -->
        <div id="af-vitals-section" style="display:none;margin:12px 0;">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;">
            <div style="text-align:center;border:1px solid rgba(160,130,70,.35);padding:6px 4px;">
              <div style="font-family:Courier Prime,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;color:#8a7a5a;">HP</div>
              <div style="font-family:'Special Elite',monospace;font-size:16px;color:#1c1608;" id="af-vital-hp">&mdash;</div>
            </div>
            <div style="text-align:center;border:1px solid rgba(160,130,70,.35);padding:6px 4px;">
              <div style="font-family:Courier Prime,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;color:#8a7a5a;">WP</div>
              <div style="font-family:'Special Elite',monospace;font-size:16px;color:#1c1608;" id="af-vital-wp">&mdash;</div>
            </div>
            <div style="text-align:center;border:1px solid rgba(160,130,70,.35);padding:6px 4px;">
              <div style="font-family:Courier Prime,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;color:#8a7a5a;">SAN</div>
              <div style="font-family:'Special Elite',monospace;font-size:16px;color:#1c1608;" id="af-vital-san">&mdash;</div>
            </div>
            <div style="text-align:center;border:1px solid rgba(160,130,70,.35);padding:6px 4px;">
              <div style="font-family:Courier Prime,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;color:#8a7a5a;">BP</div>
              <div style="font-family:'Special Elite',monospace;font-size:16px;color:#1c1608;" id="af-vital-bp">&mdash;</div>
            </div>
          </div>
          <div id="af-bonds-list"></div>
        </div>

        <!-- Era selector — shown when no eras exist yet -->
        <div id="af-era-select" style="display:none;">
          <div class="paper-stack" style="margin-top:12px;">
            <div class="paper">
              <div class="paper-rules"></div><div class="paper-margin"></div>
              <div class="holes"><div class="hole"></div><div class="hole"></div><div class="hole"></div></div>
              <div class="paper-content">
                <div class="af-section-head">Select Campaign Era</div>
                <p class="af-sub">No era pages found for this agent. Choose the first era to create the file.</p>
                <div class="era-grid">
                  <div class="era-option" onclick="initEra('90s')"><div class="era-decade">1990s</div><div class="era-sub">Cold War Aftermath</div></div>
                  <div class="era-option" onclick="initEra('00s')"><div class="era-decade">2000s</div><div class="era-sub">War on Terror</div></div>
                  <div class="era-option" onclick="initEra('10s')"><div class="era-decade">2010s</div><div class="era-sub">Digital Age</div></div>
                  <div class="era-option" onclick="initEra('20s')"><div class="era-decade">2020s</div><div class="era-sub">Present Day</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Stacked era pages -->
        <div id="af-pages-wrap" style="display:none;margin-top:12px;">
          <div class="era-stack" id="era-stack"></div>
          <button class="af-add-era-btn" id="af-add-era-btn" onclick="showEraSelect()" style="display:none;">+ Add Era</button>
        </div>

        <!-- Medical History -->
        <div id="af-medical" style="display:none;">
          <div class="af-section-divider"></div>
          <div class="af-section-head">Medical History</div>
          <div id="medical-entries"></div>
          <div id="med-add-form" style="display:none;">
            <div class="med-report-paper">
              <div class="med-report-header">
                <div class="med-report-title">MEDICAL INCIDENT REPORT</div>
                <div class="med-report-sub">Delta Green Medical Division — Restricted</div>
              </div>
              <div class="two">
                <div class="fg"><label>Date of Incident</label><input type="date" id="med-date" class="fi"></div>
                <div class="fg"><label>Severity</label>
                  <select id="med-severity" class="fs">
                    <option value="minor">Minor</option>
                    <option value="moderate">Moderate</option>
                    <option value="severe">Severe</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div class="fg"><label>Affected Area</label><input type="text" id="med-body-part" class="fi" placeholder="e.g. Left cheek, right shoulder"></div>
              <div class="fg"><label>Nature of Injury</label><input type="text" id="med-injury" class="fi" placeholder="e.g. Gunshot wound, laceration, burn"></div>
              <div class="fg"><label>Clinical Description</label><textarea id="med-desc" class="ft" placeholder="Describe the injury and circumstances..."></textarea></div>
              <div class="fg"><label>Appearance Impact</label><textarea id="med-appearance" class="ft" placeholder="How does this visibly change the agent? This updates portrait prompts."></textarea></div>
              <div class="fg">
                <label>Appearance Prompt <span class="opt">(generate from injury data)</span></label>
                <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center;">
                  <button type="button" id="med-form-gen-btn" onclick="generateMedFormPrompt()" style="font-family:'Special Elite',monospace;font-size:8px;letter-spacing:.12em;text-transform:uppercase;background:var(--ink);color:var(--paper);border:none;padding:7px 14px;cursor:pointer;">Generate Prompt</button>
                  <button type="button" id="med-form-copy-btn" onclick="copyMedFormPrompt()" style="font-family:'Special Elite',monospace;font-size:8px;letter-spacing:.12em;text-transform:uppercase;background:transparent;color:var(--ink-2);border:1px solid var(--rule);padding:7px 14px;cursor:pointer;">Copy</button>
                  <span id="med-form-gen-status" style="font-family:'Courier Prime',monospace;font-size:10px;font-style:italic;color:var(--ink-2);"></span>
                </div>
                <textarea id="med-form-prompt" class="ft" style="min-height:80px;background:rgba(0,0,0,.03);border:1px dashed var(--rule);font-size:10px;line-height:1.7;" placeholder="Generated appearance prompt will appear here — copy it to your image tool, then upload the result below."></textarea>
              </div>
              <div class="fg"><label>Reference Photo <span class="opt">(upload image generated from prompt)</span></label>
                <div class="upload-zone" onclick="document.getElementById('med-photo').click()">
                  <input type="file" id="med-photo" accept="image/*" onchange="handleMedPhoto(this)">
                  <div class="upload-hint">Tap to upload injury reference</div>
                  <img id="med-photo-prev" class="upload-prev">
                </div>
              </div>
              <div class="submit-row">
                <button class="submit-btn" onclick="saveMedEntry()">Save Entry</button>
                <span id="med-save-status" style="font-family:'Courier Prime',monospace;font-size:11px;color:var(--ink-2);"></span>
              </div>
            </div>
          </div>
          <button class="af-add-era-btn" onclick="toggleMedForm()">+ Add Medical Entry</button>
        </div>

        <!-- After-Action Reports -->
        <div id="af-aar" style="display:none;">
          <div class="af-section-divider"></div>
          <div class="af-section-head">After-Action Reports</div>
          <div id="aar-entries" class="aar-grid"></div>
          <div id="aar-add-form" style="display:none;">
            <div class="med-report-paper">
              <div class="med-report-header">
                <div class="med-report-title">AFTER-ACTION REPORT</div>
                <div class="med-report-sub">Delta Green Field Operations — Classified</div>
              </div>
              <div class="two">
                <div class="fg"><label>Date</label><input type="date" id="aar-date" class="fi"></div>
                <div class="fg"><label>Operation Name</label><input type="text" id="aar-op" class="fi" placeholder="e.g. Operation Nightfall"></div>
              </div>
              <div class="fg"><label>Location</label><input type="text" id="aar-location" class="fi" placeholder="e.g. Abandoned warehouse, Madison FL"></div>
              <div class="fg"><label>Scene Description</label>
                <textarea id="aar-scene" class="ft" placeholder="Describe the scene for the surveillance photo. What happened, where, what was the mood, lighting, key visual elements..."></textarea>
              </div>
              <div class="fg"><label>Surveillance Photo <span class="opt">(optional)</span></label>
                <div class="upload-zone" onclick="document.getElementById('aar-photo').click()">
                  <input type="file" id="aar-photo" accept="image/*" onchange="handleAarPhoto(this)">
                  <div class="upload-hint">Tap to upload surveillance photo</div>
                  <img id="aar-photo-prev" class="upload-prev">
                </div>
              </div>
              <!-- Case Officer Debrief -->
              <div class="co-debrief-box" id="co-debrief-box">
                <div class="co-debrief-label">CASE OFFICER DEBRIEF</div>
                <div class="co-debrief-content" id="co-debrief-content">Generate a cinematic Banana Pro prompt from your scene description above.</div>
                <button class="co-debrief-btn" onclick="generateDebriefPrompt()">Generate Prompt</button>
              </div>
              <div class="submit-row">
                <button class="submit-btn" onclick="saveAarEntry()">File Report</button>
                <span id="aar-save-status" style="font-family:'Courier Prime',monospace;font-size:11px;color:var(--ink-2);"></span>
              </div>
            </div>
          </div>
          <button class="af-add-era-btn" onclick="toggleAarForm()">+ File New Report</button>
        </div>

      </div><!-- af-content -->
</section>
<!-- ══ AAR DETAIL VIEW ══ -->
<div id="aar-detail-overlay" onclick="if(event.target===this) closeAarDetail()">
  <div id="aar-detail-card">
    <button id="aar-detail-close" onclick="closeAarDetail()">✕ CLOSE</button>
    <div class="aar-detail-op" id="aar-detail-op"></div>
    <div class="aar-detail-meta" id="aar-detail-meta"></div>
    <img class="aar-detail-photo" id="aar-detail-photo" alt="" style="display:none">
    <div class="aar-detail-scene" id="aar-detail-scene"></div>
    <div class="co-debrief-box" id="aar-detail-prompt-box" style="display:none">
      <span class="co-debrief-label">Cinematic Prompt</span>
      <div class="co-debrief-content" id="aar-detail-prompt"></div>
    </div>
  </div>
</div>
</div>`;
  document.body.appendChild(holder);
})();

// Only the legacy Drive image proxy (imgdata, for a pre-Storage
// 'gdrive:' photo link) still calls Apps Script -- and none remain once
// runMigrateDriveFilesToStorageNow() has run. Everything else below
// goes to Firestore through afFetch()/afJsonp().
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';

/* ── Firestore stand-ins for the retired Apps Script calls ──
   The Google Sheet behind the old backend is retired. These keep every
   call site on this page exactly as it was -- same payloads, same
   replies -- while the data goes to Firestore via assets/dg-store.js:
     afFetch(payload)  was fetch(APPS_SCRIPT_URL, {body: JSON.stringify(payload)})
                       -> resolves to { json(): reply } like a fetch Response
     afJsonp(kind, code, callbackName, scriptEl)
                       was a <script src="...?code=...&callback=..."> lookup;
                       calls window[callbackName](reply) the same way, or
                       scriptEl.onerror() on a connection failure. */
function afReply_(obj) { return { ok: true, json: function () { return Promise.resolve(obj); } }; }
function afFetch(payload) {
  const p = Object.assign({}, payload || {});
  const code = String(p.agent_code || '').trim().toUpperCase();
  delete p.token;
  let work;
  switch (p.action) {
    case 'update_field':
      if (!p.field || p.field === 'agent_code') return Promise.reject(new Error('Field not allowed: ' + p.field));
      work = window.dgStore.updateBrief(code, { [p.field]: p.value }).then(() => ({ status: 'OK' }));
      break;
    case 'update_medical':
      work = window.dgStore.updateBrief(code, { medical_log: p.medical_log || '' }).then(() => ({ status: 'OK' }));
      break;
    case 'update_aar':
      work = window.dgStore.updateBrief(code, { aar_log: p.aar_log || '' }).then(() => ({ status: 'OK' }));
      break;
    case 'save_plate':
      if (!p.storage_url) return Promise.reject(new Error('Plate image must be uploaded to Storage first.'));
      work = window.dgStore.updateBrief(code, { [p.field]: p.storage_url }).then(() => ({ status: 'OK' }));
      break;
    case 'generate_prompt':
    case 'generate_plate_image': {
      delete p.action;
      const call = payload.action === 'generate_prompt' ? window.dgStore.generatePrompt : window.dgStore.generatePlateImage;
      // "internal" is the SDK's word for "no usable answer" (the function
      // crashed, or the request never got through) -- say so plainly.
      work = call(code, p).catch(err => ({ status: 'ERROR', message: (err && err.code === 'functions/internal')
        ? 'the AI service did not answer. Try again in a minute; if it keeps failing, tell your Handler.'
        : ((err && err.message) || 'Request failed.') }));
      break;
    }
    default: {
      // A Profiling / brief submission (no action). The photo was already
      // uploaded to Storage; record its link only when there is a new one.
      if (p.ref_storage_url) p.ref_image_link = p.ref_storage_url;
      delete p.ref_storage_url; delete p.ref_image_base64; delete p.ref_image; delete p.action;
      work = window.dgStore.submitBrief(p).then(c => ({ status: 'OK', agent_code: c }));
    }
  }
  return work.then(afReply_);
}
function afJsonp(kind, code, cbName, scriptEl) {
  const get = kind === 'character'
    ? window.dgStore.getCharacter(code).then(d => d ? { status: 'OK', agent_code: d.agent_code, character_json: d.character_json, updated_at: d.updated_at } : { status: 'NOT_FOUND' })
    : window.dgStore.getBrief(code).then(d => d ? { status: 'OK', data: d } : { status: 'NOT_FOUND' });
  get.then(reply => {
    const cb = window[cbName];
    if (typeof cb === 'function') cb(reply);
  }, () => {
    if (scriptEl && typeof scriptEl.onerror === 'function') scriptEl.onerror();
    else if (typeof window[cbName] === 'function') window[cbName]({ status: 'ERROR' });
  });
}

/* ── LOCAL PERSISTENCE ── */
const LS_KEY = 'dg_last_agent';
function persistAgent(code, data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ code, data })); } catch(e) {}
  if (typeof rosterAddAgent === 'function') rosterAddAgent(code, data);
}


// "Filled out totally and submitted", not just "a Delta Green Briefs
// row exists" -- stats/'s "Open Agent File" button (goToAgentFile() in
// agent-portal-export.js) auto-exports a real row with only name / age
// range / sex / nationality / profession / build / outfit set, POSTed
// directly rather than through this form's own required-field
// validation, so a freshly-auto-exported Agent can have a row on the
// backend while still being nowhere near a finished Profiling brief.
// Reads #dg-form's own [required] fields rather than a hardcoded list,
// so this stays correct if the form's required fields ever change.
function isProfilingComplete(data) {
  if (!data) return false;
  const form = document.getElementById('dg-form');
  if (!form) return false;
  return Array.from(form.querySelectorAll('[required]')).every(el => {
    const v = data[el.name];
    return v !== undefined && v !== null && String(v).trim().length > 0;
  });
}



/* ── ARCHETYPE INIT ── */
(function initArchetypes() {
  setTimeout(() => {
    const sel = document.getElementById('rand-profession');
    if (!sel || sel.options.length > 1) return;
    ARCHETYPES.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.label;
      sel.appendChild(opt);
    });
  }, 50);
})();

/* ── PHOTO ── */
let photoDataUrl = null;
// Separate from photoDataUrl, which also gets populated when an
// existing Agent's data is restored/loaded (a gdrive: link resolved to
// a preview data URI, see the restore path's own comment) -- this one
// is set ONLY when the player actually picks a NEW file this session,
// which is what decides whether handleSubmit() below needs to upload
// anything at all.
let refImageFile = null;
document.getElementById('ref-img').addEventListener('change', async function() {
  if (this.files[0]) {
    refImageFile = this.files[0];
    photoDataUrl = await f2b(this.files[0]);
    const p = document.getElementById('upload-prev');
    p.src = photoDataUrl; p.style.display = 'block';
  }
});

/* ── Firebase Storage: direct client upload for the reference photo
   (Phase 4). Self-contained copy of the same loader/sign-in pattern
   assets/dice-roller.js and a-cell.html's own script sections each
   already use independently. Signs in as the AGENT (not the Handler --
   this form has no Handler context at all), reusing the already-live
   exchangeAgentToken function Dice Roller's own Agent sign-in already
   calls; matches this whole migration's real security posture
   (requireAgentToken_() in Code.gs is a deliberate no-op -- see its own
   comment there), not a new hole. ── */
var FIREBASE_SDK_VERSION = '12.18.0';
var FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBiFBvgmrjtacxXvh7FHa9a28BbwV0LnDQ',
  authDomain: 'dg-app-b3447.firebaseapp.com',
  projectId: 'dg-app-b3447',
  storageBucket: 'dg-app-b3447.firebasestorage.app',
  messagingSenderId: '464997490443',
  appId: '1:464997490443:web:dad47a347ae7a64a9e4c0e'
};
var firebaseApiLoading = false;
var firebaseApiCallbacks = [];
function loadFirebaseScriptTag(src, cb) {
  var s = document.createElement('script');
  s.src = src;
  s.onload = cb;
  // One copy of each Firebase SDK file per page: reuse a tag another
  // widget already added (loaded, or still loading) instead of adding
  // a second -- two copies of firebase-app-compat.js left every
  // Firestore call on the page hanging (BUGFIXES.md, Sheet retired).
  var dgPrev = Array.prototype.filter.call(document.scripts, function (x) { return x !== s && x.src === s.src && x.dataset.dgFailed !== '1'; })[0];
  if (dgPrev) {
    if (dgPrev.dataset.dgLoaded === '1') { if (s.onload) s.onload(); return; }
    dgPrev.addEventListener('load', function () { if (s.onload) s.onload(); }, { once: true });
    dgPrev.addEventListener('error', function () { if (s.onerror) s.onerror(); }, { once: true });
    return;
  }
  s.addEventListener('load', function () { s.dataset.dgLoaded = '1'; });
  s.addEventListener('error', function () { s.dataset.dgFailed = '1'; });
  document.head.appendChild(s);
}
function ensureFirebaseApi(cb) {
  var ready = function () { return window.firebase && window.firebase.storage && window.firebase.auth && window.firebase.functions; };
  if (ready()) { cb(); return; }
  firebaseApiCallbacks.push(cb);
  if (firebaseApiLoading) return;
  firebaseApiLoading = true;
  var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/';
  var loadIfMissing = function (check, url, next) { if (check()) { next(); } else { loadFirebaseScriptTag(url, next); } };
  loadIfMissing(function () { return window.firebase && window.firebase.apps; }, base + 'firebase-app-compat.js', function () {
    if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
    loadIfMissing(function () { return !!window.firebase.auth; }, base + 'firebase-auth-compat.js', function () {
      // Real live report: Handler-gated reads/writes started failing
      // with "Missing or insufficient permissions" mid-session, as
      // often as every couple of minutes -- root cause: Firebase Auth's
      // DEFAULT persistence (browserLocalPersistence) is shared across
      // every open tab of this origin via IndexedDB, so any tab signing
      // in as an Agent (this page) silently evicts a Handler session
      // signed in from a-cell.html in another tab, and vice versa.
      // SESSION persistence keeps each tab's sign-in local to that tab.
      // Must be set before any sign-in call -- see a-cell.html's own
      // copy of this comment for the full mechanism.
      window.firebase.auth().setPersistence(window.firebase.auth.Auth.Persistence.SESSION).catch(function (err) {
        console.error('agent-file: could not set SESSION auth persistence (falling back to default, cross-tab-shared behavior)', err);
      }).then(function () {
      loadIfMissing(function () { return !!window.firebase.functions; }, base + 'firebase-functions-compat.js', function () {
        loadIfMissing(function () { return !!window.firebase.storage; }, base + 'firebase-storage-compat.js', function () {
          var cbs = firebaseApiCallbacks; firebaseApiCallbacks = [];
          cbs.forEach(function (fn) { fn(); });
        });
      });
      });
    });
  });
}
var _agentAuthPromise = null;
var _agentAuthCode = null;
function ensureAgentSignedIn(agentCode) {
  // Re-signs in if a DIFFERENT Agent Code shows up (e.g. this same tab
  // submits a second, unrelated brief) -- a memoized promise keyed to
  // whichever code signed in first would otherwise silently keep using
  // the wrong identity for every Agent after the first one.
  if (_agentAuthPromise && _agentAuthCode === agentCode) return _agentAuthPromise;
  _agentAuthCode = agentCode;
  _agentAuthPromise = new Promise(function (resolve, reject) {
    ensureFirebaseApi(function () {
      var auth = window.firebase.auth();
      window.firebase.functions().httpsCallable('exchangeAgentToken')({ agent_code: agentCode })
        .then(function (result) { return auth.signInWithCustomToken(result.data.token); })
        .then(function (cred) { resolve(cred.user); })
        .catch(function (err) { _agentAuthPromise = null; reject(err); });
    });
  });
  return _agentAuthPromise;
}
function extensionForFile_(file) {
  var type = file.type || '';
  if (type.indexOf('image/') === 0) return '.' + type.slice('image/'.length);
  var m = /\.[a-z0-9]+$/i.exec(file.name || '');
  return m ? m[0] : '';
}

/* ── CODE GENERATION -- shared with stats/cloud-sync.js and
   stats/agent-portal-export.js via assets/agent-code.js ── */
function genCode(name) {
  return window.dgAgentCode.gen(name);
}


/* ── SUBMIT ── */
async function handleSubmit() {
  // The form's [required] attributes were purely decorative until now --
  // this button is type="submit" inside a form with onsubmit="return
  // false", so the browser's own constraint validation never actually
  // blocked a submission, it just fired handleSubmit() unconditionally on
  // click. isProfilingComplete() (used to gate the Agent File tab) reads
  // those same [required] fields as its source of truth, so a brief that
  // slipped through with some left blank could submit successfully here
  // and then permanently fail that gate later, with no indication to the
  // player of what's actually missing. Enforce it for real at the one
  // place data leaves this form, so a blocked submission always comes
  // with the browser's own "please fill this out" pointer at the field.
  const form = document.getElementById('dg-form');
  if (!form.reportValidity()) return;

  const btn = document.getElementById('submit-btn');
  const status = document.getElementById('form-status');
  const originalBtnLabel = btn.textContent;
  btn.disabled=true; status.className=''; status.textContent='Transmitting...';
  const payload={};
  new FormData(document.getElementById('dg-form')).forEach((v,k)=>{ payload[k]=v; });
  payload.submitted_at = new Date().toISOString();
  // The form always describes the Agent whose Agent Hub tab is open, so
  // that Agent's code is the one to save under -- renaming them here
  // renames them, it never splits off a second Agent. (On the old
  // standalone Agent Portal the code had to be guessed from the name or
  // the roster, which is where duplicate Agents used to come from.)
  const agentCode = afMountedCode || afCode || genCode(payload.char_name);
  const sameAgent = !!(afData && afCode === agentCode);
  // Editing an existing Agent's Profiling: carry over everything this
  // form doesn't itself edit (eras, every era's Plates and prompts, the
  // Active Era, medical/AAR logs, Profession...). The brief upsert
  // (backend before v96) blanked every column a submission didn't
  // include, so the first "Update Brief" after building an Agent File
  // wiped it -- and this page then showed "choose the first era" again.
  // afData is kept current by every write on this page (and refreshed
  // from the server on load), so it's the right source.
  if (sameAgent) {
    Object.keys(afData).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) return;
      if (k === 'ref_image' || k === 'ref_image_base64' || k === 'ref_image_name' || k === 'agent_code') return;
      payload[k] = afData[k];
    });
  }
  // An empty "Your Name" box never wipes a Player Name already on file
  // (the form can still be filling in from the Agent File when a quick
  // player hits Submit): keep the saved one, else the Hub's Cover
  // Identity. Without it, Load My Agents on another device can't find
  // this Agent File, and its Face Plate/codename/eras go missing there.
  if (!String(payload.player_name || '').trim()) {
    let known = (sameAgent && afData && afData.player_name) || '';
    if (!known) { try { known = localStorage.getItem('dg_cover_identity') || ''; } catch (e) { /* storage blocked */ } }
    if (known) payload.player_name = known;
  }
  if (refImageFile) {
    status.textContent = 'Uploading photo…';
    btn.textContent = 'Uploading…';
    try {
      const user = await ensureAgentSignedIn(agentCode);
      const path = 'agent-refs/' + agentCode + extensionForFile_(refImageFile);
      const snapshot = await window.firebase.storage().ref(path).put(refImageFile, { contentType: refImageFile.type || 'image/jpeg' });
      payload.ref_storage_url = await snapshot.ref.getDownloadURL();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = originalBtnLabel;
      status.className = '';
      status.textContent = 'Could not upload the photo: ' + ((err && err.message) || 'unknown error') + ' -- try again.';
      return;
    }
  }
  payload.agent_code = agentCode;
  persistAgent(agentCode, payload);
  afCode = agentCode;
  afData = payload;
  status.className='ok'; status.textContent='Brief received. Stand by for orders.';
  btn.textContent='Submitted';
  try {
    await afFetch(payload);
  } catch(e){ console.error(e); }
  // reportValidity() above guarantees a complete brief, so the Agent
  // File is unlocked -- go straight there instead of showing the old
  // inline printable dossier card underneath the Profiling form.
  openInAgentFile();
}

/* ── DOSSIER ── */


/* ── RESTORE ──
   populateCoverForm() is shared with loadAgentFile() below -- an Agent
   opened via agent-hub.html's "Agent File" link (?code=XXX#agent, see
   openSpecificAgent()) only used to call loadAgentFile(), which renders
   the read-only Agent File dossier but never touched this Cover form at
   all, so clicking over to the Cover tab afterward showed a blank form
   instead of the Agent's actual data -- the exact same fetch just
   hadn't been wired to fill it in. */
function populateCoverForm(data){
  // ref_image is the Cover form's own file input's name -- a browser
  // throws if a file input's .value is set to anything but '', and
  // afData can come from this page's OWN just-submitted payload (built
  // via FormData(), which turns that input's key into a File object),
  // not just the backend's read-only doLookup() response (which never
  // has a raw ref_image key, only ref_image_link/_name/_base64). The
  // actual photo already round-trips through ref_image_base64 -> the
  // photoDataUrl assignment below, so skipping the raw input is lossless.
  const skipKeys = new Set(['medical_log','aar_log','ref_image','ref_image_base64','active_eras','banana_prompt']);
  const form=document.getElementById('dg-form');
  if (!form) return;
  Object.keys(data).forEach(key=>{
    if(skipKeys.has(key)) return;
    const el=form.elements[key];
    // Belt-and-suspenders against any *other* file input this form
    // gains later under a name skipKeys doesn't yet know about.
    if(!el || el.type === 'file') return;
    const val = data[key] || '';
    el.value = val;
    // Locks this field against the Random Agent Generator (see
    // fillFormFromAgent()) -- a field with real, already-known Agent
    // data (a prior submission, a restore, or -- via stats/'s
    // "Open Agent File" auto-export -- the linked character sheet's own
    // name/sex/profession/build) shouldn't get silently rerolled into
    // something else just because the player clicked Random Generate to
    // fill in the rest. An empty value un-locks the field, so clearing
    // it by hand still leaves it randomizable.
    el.classList.toggle('cover-field-locked', !!val);
    if (val) el.dataset.locked = '1'; else delete el.dataset.locked;
  });
  document.getElementById('submit-btn').textContent='Update Brief';
  document.getElementById('submit-btn').disabled=false;
  if (data.ref_image_base64) photoDataUrl = data.ref_image_base64;
}

/* ── AUTO-CREATE A MISSING BRIEF FROM THE CHARACTER SHEET ──
   A real report (Eli Filagree): a Kappa Black import synced fine to
   the Characters sheet, but nobody had ever clicked stats/'s "Open
   Agent File" button for this Agent -- so no Delta Green Briefs row
   existed at all, and EVERY way of reaching the Agent File (the Hub's
   own "Agent File" link, the Cover tab's "RETURNING AGENT" code box)
   returned a correct but unhelpful NOT_FOUND forever, with no
   indication that the character sheet itself was actually fine.
   stats/agent-portal-export.js already solves this exact gap, but only
   for the ONE entry point a player happens to click that specific
   button from -- this is the same auto-export, triggered instead the
   moment ANY entry point discovers a missing Brief for an Agent who
   does have a saved character, so the gap self-heals regardless of
   which door the player came in through. Deliberately minimal (name/
   profession/nationality/sex only, no outfit/build derivation --
   Agent Hub doesn't have stats/'s professions.js/bio.js
   loaded to do that part the same way) -- isProfilingComplete()'s
   existing incomplete-Profiling banner already prompts the player to
   fill in the rest, same as any other partial brief. */
function autoCreateBriefFromCharacterThenRetry_(code, onCreated, onGiveUp) {
  window._acbCallback = function (json) {
    delete window._acbCallback;
    const old = document.getElementById('_acb_script');
    if (old) old.remove();
    let bio = {};
    try { bio = (json.status === 'OK' && json.character_json) ? (JSON.parse(json.character_json).bio || {}) : null; }
    catch (e) { bio = null; }
    const name = bio && (bio.name || '').trim();
    if (!bio || !name || name === 'Agent') { onGiveUp(); return; }
    const sexRaw = (bio.sex || '').trim().toLowerCase();
    const sex = sexRaw === 'male' || sexRaw === 'm' ? 'Male' : sexRaw === 'female' || sexRaw === 'f' ? 'Female' : sexRaw ? 'Other' : '';
    // bio.profession is stats/'s internal key ("federal_agent"), not the
    // title -- the dossier used to print it raw. Same titles as
    // stats/professions.js (not loaded on this page).
    const PROF_TITLES = {
      anthropologist: 'Anthropologist or Historian', federal_agent: 'Federal Agent', physician: 'Physician',
      computer_scientist: 'Computer Scientist or Engineer', scientist: 'Scientist', special_operator: 'Special Operator',
      criminal: 'Criminal', firefighter: 'Firefighter', police_officer: 'Police Officer', soldier_marine: 'Soldier or Marine',
      foreign_service: 'Foreign Service Officer', intelligence_analyst: 'Intelligence Analyst',
      intelligence_case_officer: 'Intelligence Case Officer', lawyer_executive: 'Lawyer or Business Executive',
      media_specialist: 'Media Specialist', nurse_paramedic: 'Nurse or Paramedic', pilot_sailor: 'Pilot or Sailor',
      program_manager: 'Program Manager'
    };
    const profKey = (bio.profession || '').trim();
    const profession = PROF_TITLES[profKey] || (profKey === 'new_profession' ? '' : profKey);
    const payload = {
      char_name: name,
      player_name: (bio.player_name || '').trim(),
      profession: profession,
      nationality: bio.nationality || '',
      sex: sex,
      notes: 'Auto-created from this Agent\'s character sheet -- no Agent File was on record yet.',
      agent_code: code,
      submitted_at: new Date().toISOString()
    };
    afFetch(payload)
      .then(function () { setTimeout(onCreated, 700); })
      .catch(onGiveUp);
  };
  const s = document.createElement('script');
  s.id = '_acb_script';
  s.dataset.af = "1"; afJsonp('character', code, '_acbCallback', s);
  s.onerror = onGiveUp;
  document.head.appendChild(s);
}



/* ── OPEN IN AGENT FILE ── */

/* ── DRIVE IMAGE LOADING ── */
function extractDriveId(url) {
  if (!url) return null;
  if (url.startsWith('gdrive:')) return url.slice(7);
  const shareMatch = url.match(/\/file\/d\/([^\/\?]+)/);
  if (shareMatch) return shareMatch[1];
  const ucMatch = url.match(/[?&]id=([^&]+)/);
  if (ucMatch) return ucMatch[1];
  return null;
}
function driveDirectUrl(url) {
  const id = extractDriveId(url);
  if (id) return 'gdrive:' + id;
  return url || '';
}
// Plates uploaded since the Firebase Storage move (Phase 4) are plain,
// publicly readable https:// download URLs -- an <img> can load those
// directly, same as agent-hub.html's loadFacePlate() and
// lp-tracker-photo.js already do. Everything below used to assume a
// gdrive:FILE_ID, so a Storage-hosted Face/Outfit Plate rendered as an
// empty box on every return to the Agent File (and never reached the
// Field ID card or the roster drawer).
function isDirectImageUrl_(url) {
  return /^https?:\/\//.test(url || '') && !extractDriveId(url);
}
function loadDriveImage(url, imgId) {
  if (isDirectImageUrl_(url)) {
    const el = document.getElementById(imgId);
    if (el) { el.src = url; el.style.display = 'block'; }
    return;
  }
  const id = extractDriveId(url);
  if (!id) return;
  const cbName = '_driveImg_' + id.replace(/[^a-zA-Z0-9]/g, '_');
  // Remove any stale script from a previous load of this image
  const old = document.getElementById('_ds_' + id);
  if (old) old.remove();
  window[cbName] = function(json) {
    delete window[cbName];
    const s = document.getElementById('_ds_' + id);
    if (s) s.remove();
    if (json.status === 'OK' && json.dataUri) {
      const el = document.getElementById(imgId);
      if (el) { el.src = json.dataUri; el.style.display = 'block'; }
    }
  };
  const s = document.createElement('script');
  s.id = '_ds_' + id;
  s.src = APPS_SCRIPT_URL + '?action=imgdata&id=' + encodeURIComponent(id) + '&callback=' + cbName;
  document.head.appendChild(s);
}

/* ── EDIT LOOK ── */

/* ── PROMPT SAVE / COPY ── */



/* ── UTILS ── */
function f2b(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);
  });
}


/* ══════════════════════════════════════
   PHASE 2 — AGENT FILE JS
   ══════════════════════════════════════ */

let afData = null;       // current agent data
let afCode = null;       // current agent code
let afEraPages = [];     // rendered era pages
let afActiveEra = null;  // currently front era
// A just-generated/uploaded Face Plate's data URI, kept in memory so an
// Outfit Plate generated in the same session can reuse it immediately as
// a reference without round-tripping through Drive -- saveGeneratedPlate()
// never updates afData.face_plate_url itself (that write is a fire-and-
// forget no-cors POST with no response to read back), so afData would
// otherwise stay stale until the next full page load.
let afRecentFacePlateDataUri = {};
let afMedPhotos = {};    // temp photo store for medical entries
let afAarPhotos = {};    // temp photo store for AAR

/* ── Load agent file from Sheet ── */

/* ── Background refresh after rendering from the local copy ──
   openSpecificAgent()/autoRestore() render straight from dg_last_agent
   (fast, and immune to a just-fired save still being in flight), but
   that snapshot is only written on a brief submit/restore -- a Face or
   Outfit Plate generated since, a new era, the Active Era, a Handler's
   edit, or anything done on another device were all missing on every
   return visit ("No face plate on file" for an Agent who has one) until
   the player happened to use Load Different Agent. Fetch the real row
   once in the background and re-render if it's at least as new as the
   local copy (submitted_at) -- an older server row means a brief save
   from this device hasn't landed yet, and the local copy stays. */

/* ── Show gate, hide content ── */

/* ── Render the full agent file ── */
function renderAgentFile(data) {
  document.getElementById('af-gate').style.display = 'none';
  document.getElementById('af-content').style.display = 'block';

  // Header
  document.getElementById('af-agent-name').textContent = data.char_name || '—';
  document.getElementById('af-agent-code').textContent = afCode;
  checkAgentKia(afCode);

  // Check for era data in sheet
  const eras = parseEras(data);

  if (eras.length === 0) {
    // First time — show era selector
    syncEraSelect_();
    document.getElementById('af-era-select').style.display = 'block';
    document.getElementById('af-pages-wrap').style.display = 'none';
  } else {
    document.getElementById('af-era-select').style.display = 'none';
    document.getElementById('af-pages-wrap').style.display = 'block';
    renderEraStack(eras, data);
  }

  // Medical History + After-Action Reports: archived, not removed --
  // left at their markup's own default display:none rather than ever
  // being flipped to 'block'. Everything backing them (the sheet
  // columns, Code.gs's update_medical/AAR actions, the render/save
  // functions below) is untouched, so restoring the feature later is
  // just re-adding these two lines.

  // Ensure add forms are closed
  document.getElementById('med-add-form').style.display = 'none';
  document.getElementById('aar-add-form').style.display = 'none';
  medFormVisible = false;
  aarFormVisible = false;

  renderMedicalEntries(data);
  renderAarEntries(data);
}

function afEscapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/* ── KIA stamp + Vitals/Bonds: a live read of this Agent's saved
   character sheet (the Cloud Save record stats/ writes to, not this
   file's own Briefs data), so it reflects whatever was last synced --
   heal the Agent back above 0 and the KIA stamp clears on its own next
   time this loads, same as it appeared. The HP/WP/SAN/BP scores and
   Bond list mirror what A-Cell's Handler-only Play view already shows
   (renderView() in a-cell.html) -- surfaced here too so a player can
   see their own scoring without needing a Handler to look it up.
   Best-effort throughout: no cloud character yet (never built one) or
   an unreachable backend both just leave everything hidden, same
   graceful-degradation every other Apps Script call here already has. ── */
function checkAgentKia(code) {
  const stamp = document.getElementById('af-kia-stamp');
  const nameEl = document.getElementById('af-agent-name');
  const vitalsSection = document.getElementById('af-vitals-section');
  if (!stamp || !code) return;
  stamp.style.display = 'none';
  if (nameEl) nameEl.classList.remove('kia-name');
  if (vitalsSection) vitalsSection.style.display = 'none';

  const cbName = '_afKiaCb' + Date.now();
  const timer = setTimeout(() => { window[cbName] = function () { delete window[cbName]; }; }, 7000);
  window[cbName] = function (res) {
    clearTimeout(timer);
    delete window[cbName];
    const s = document.getElementById('_af_kia_script');
    if (s) s.remove();
    if (!res || res.status !== 'OK' || !res.character_json) return;
    let state;
    try { state = JSON.parse(res.character_json); } catch (e) { return; }
    const derived = (state && state.derived) || {};
    const hp = derived.hp;
    if (typeof hp === 'number' && hp <= 0) {
      stamp.style.display = 'inline-block';
      if (nameEl) nameEl.classList.add('kia-name');
    }

    if (vitalsSection) {
      const hpEl = document.getElementById('af-vital-hp');
      const wpEl = document.getElementById('af-vital-wp');
      const sanEl = document.getElementById('af-vital-san');
      const bpEl = document.getElementById('af-vital-bp');
      if (hpEl) hpEl.textContent = derived.hp ?? '—';
      if (wpEl) wpEl.textContent = derived.wp ?? '—';
      if (sanEl) sanEl.textContent = derived.san ?? '—';
      if (bpEl) bpEl.textContent = derived.bp ?? '—';

      // Not eraDataField() -- it hides a row whose value is falsy, which
      // would wrongly hide a legitimate Bond score of 0.
      const bonds = Array.isArray(state.bonds) ? state.bonds : [];
      const bondsList = document.getElementById('af-bonds-list');
      if (bondsList) {
        bondsList.innerHTML = bonds.length
          ? bonds.map(function (b) {
              const label = [b.name, b.relationship].filter(Boolean).map(afEscapeHtml).join(' &middot; ');
              const score = typeof b.score === 'number' ? b.score : '—';
              return '<div style="display:flex;border-bottom:1px solid rgba(180,150,72,.2);padding:6px 0;align-items:baseline;gap:8px;">'
                + '<span style="font-family:Courier Prime,monospace;font-size:11px;color:#1c1608;line-height:1.5;flex:1;">' + (label || 'Unnamed Bond') + '</span>'
                + '<span style="font-family:\'Special Elite\',monospace;font-size:13px;color:#1c1608;">' + score + '</span>'
                + '</div>';
            }).join('')
          : '';
      }

      vitalsSection.style.display = 'block';
    }
  };
  const s = document.createElement('script');
  s.id = '_af_kia_script';
  s.dataset.af = "1"; afJsonp('character', code, cbName, s);
  document.head.appendChild(s);
}

/* ── Parse eras from sheet data ── */
function parseEras(data) {
  // Check explicit era list field first
  if (data.active_eras) {
    try {
      const saved = JSON.parse(data.active_eras);
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch(e) {}
    // If it's a plain string like '["20s"]' handle it
    if (typeof data.active_eras === 'string' && data.active_eras.trim().startsWith('[')) {
      try {
        const saved = JSON.parse(data.active_eras.trim());
        if (Array.isArray(saved) && saved.length > 0) return saved;
      } catch(e) {}
    }
  }
  // Fallback: flat sheet columns — infer era from active_eras plain string or default to 20s
  if (data.face_plate_url || data.outfit_plate_url || data.mode0_prompt || data.mode1_prompt) {
    if (data.active_eras && typeof data.active_eras === 'string' && !data.active_eras.includes('[')) {
      const era = data.active_eras.trim();
      if (['90s','00s','10s','20s'].includes(era)) return [era];
    }
    return ['20s'];
  }
  // Default: always show 20s era selector (current campaign)
  return [];
}

/* ── Init a new era (first time) ── */
function initEra(era) {
  if (!afCode) return;

  // Build era list — add to existing
  const existing = parseEras(afData || {});
  if (!existing.includes(era)) existing.push(era);

  // Save active_eras to Sheet
  if (!afData) afData = {};
  afData.active_eras = JSON.stringify(existing);
  persistAgent(afCode, afData);

  afFetch({
      action: 'update_field',
      agent_code: afCode,
      token: agentToken(afCode),
      field: 'active_eras',
      value: afData.active_eras
    }).catch(e => console.error('Era save:', e));

  document.getElementById('af-era-select').style.display = 'none';
  document.getElementById('af-pages-wrap').style.display = 'block';
  document.getElementById('af-add-era-btn').style.display = 'block';

  renderEraStack(existing, afData);
}

/* ── Show era selector for adding a new era ── */
// The same picker serves "choose the first era" and "+ Add Era" -- it
// used to say "No era pages found for this agent" and offer every era,
// including ones already on file, when adding a second one.
function syncEraSelect_() {
  const sel = document.getElementById('af-era-select');
  if (!sel) return;
  const have = parseEras(afData || {});
  const sub = sel.querySelector('.af-sub');
  if (sub) sub.textContent = have.length
    ? 'Choose another era to add to this file.'
    : 'No era pages found for this agent. Choose the first era to create the file.';
  sel.querySelectorAll('.era-option').forEach(function (o) {
    const m = /initEra\('(\w+)'\)/.exec(o.getAttribute('onclick') || '');
    o.style.display = m && have.indexOf(m[1]) !== -1 ? 'none' : '';
  });
}
function showEraSelect() {
  syncEraSelect_();
  document.getElementById('af-era-select').style.display = 'block';
  document.getElementById('af-era-select').scrollIntoView({behavior:'smooth'});
}

/* ── Render stacked era pages ── */
function renderEraStack(eras, data) {
  const stack = document.getElementById('era-stack');
  stack.innerHTML = '';
  afEraPages = [];

  const eraLabels = {'90s':'Cold War Aftermath','00s':'War on Terror','10s':'Digital Age','20s':'Present Day'};
  const eraDecade = {'90s':'1990s','00s':'2000s','10s':'2010s','20s':'2020s'};

  eras.forEach((era, idx) => {
    // Era-specific columns are the source of truth now (every write path
    // writes these); the flat face_plate_url/outfit_plate_url/mode0_prompt/
    // mode1_prompt columns are only a fallback, for any Agent whose Plates/
    // prompts were generated before the era Plate/prompt data collision fix.
    // Gated to idx === 0 (the first/only era on the accordion) -- a
    // pre-fix Agent only ever had ONE era, always eras[0], so that's the
    // only era the flat legacy value could actually belong to. Every
    // era added after that is necessarily a genuinely new one (added
    // post-fix, since adding an era at all requires this very page); a
    // second+ era falling back to the same flat value made a brand-new,
    // still-blank era look like it already had a real Face Plate or
    // prompt, live-reported as "the face plate still loads in to the
    // latest added era" -- same underlying flaw, image side, permanent
    // instead of a self-correcting flash the way prompts' own auto-
    // generate guard already handles (see that guard's own comment).
    const faceUrl = driveDirectUrl(data['era_' + era + '_face_url'] || (idx === 0 ? data.face_plate_url : '') || '');
    const outfitUrl = driveDirectUrl(data['era_' + era + '_outfit_url'] || (idx === 0 ? data.outfit_plate_url : '') || '');
    const mode0 = data['era_' + era + '_mode0'] || (idx === 0 ? data.mode0_prompt : '') || '';
    const mode1 = data['era_' + era + '_mode1'] || (idx === 0 ? data.mode1_prompt : '') || '';
    const isOpen = idx === 0;

    const item = document.createElement('div');
    item.style.cssText = 'border:1px solid #c8b888;border-radius:1px;margin-bottom:8px;background:#f4eed8;';
    item.id = 'era-accordion-' + era;

    // Header — always visible, click to toggle
    const header = document.createElement('div');
    // Wraps onto a second line on a phone instead of running off the
    // edge; no 52px gutter (that was room for the portal's punch holes).
    header.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;min-height:48px;padding:8px 14px;border-bottom:' + (isOpen ? '2px solid #1c1608' : '1px solid rgba(180,150,72,.3)') + ';cursor:pointer;position:relative;';
    header.innerHTML = '<div style="font-family:Special Elite,monospace;font-size:20px;color:#1c1608;letter-spacing:.04em;">' + eraDecade[era] + '</div>'
      + '<div style="font-family:Courier Prime,monospace;font-size:8px;letter-spacing:.15em;text-transform:uppercase;color:#4a3f28;">' + (eraLabels[era]||'') + '</div>'
      + '<div style="margin-left:auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px 12px;">'
      + '<span id="era-preview-' + era + '"></span>'
      + '<span id="era-photo-' + era + '" style="font-family:Courier Prime,monospace;font-size:8px;color:#4a3f28;white-space:nowrap;">' + (faceUrl ? '&#9679; Photo On File' : '&#9675; No Photo Yet') + '</span>'
      + '<span id="era-chevron-' + era + '" style="font-size:12px;color:#8a7a5a;transition:transform 200ms;">' + (isOpen ? '&#9650;' : '&#9660;') + '</span>'
      + '</div>';
    header.onclick = () => toggleEraAccordion(era);
    item.appendChild(header);

    // Body — collapsible
    const body = document.createElement('div');
    body.id = 'era-body-' + era;
    body.style.cssText = 'display:' + (isOpen ? 'block' : 'none') + ';padding:20px 14px;font-family:Courier Prime,monospace;font-size:12px;color:#1c1608;';

    // Plate images
    body.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">'
      + '<div>'
      + '<div id="plate-face-' + era + '" style="border:1px solid rgba(160,130,70,.35);overflow:hidden;background:#ede5cc;min-height:80px;display:flex;align-items:center;justify-content:center;">'
      + (faceUrl ? '<img id="img-face-' + era + '" style="width:100%;display:none;object-fit:cover;">' : '<span style="font-family:Courier Prime,monospace;font-size:8px;color:rgba(160,130,70,.5);text-align:center;padding:8px;">No face plate on file</span>')
      + '</div>'
      + '<label style="font-family:Special Elite,monospace;font-size:8px;letter-spacing:.1em;text-transform:uppercase;background:transparent;color:#4a3f28;border:1px dashed rgba(160,130,70,.35);padding:4px 8px;cursor:pointer;display:block;width:100%;margin-top:2px;text-align:center;box-sizing:border-box;" for="upload-face-' + era + '">' + (faceUrl ? 'Replace Face Plate' : 'Upload Face Plate') + '</label>'
      + '<input type="file" id="upload-face-' + era + '" accept="image/*" style="display:none" data-era="' + era + '" data-type="face" onchange="handlePlateUpload(this,this.dataset.era,this.dataset.type)">'
      + '</div>'
      + '<div>'
      + '<div id="plate-outfit-' + era + '" style="border:1px solid rgba(160,130,70,.35);overflow:hidden;background:#ede5cc;min-height:80px;display:flex;align-items:center;justify-content:center;">'
      + (outfitUrl ? '<img id="img-outfit-' + era + '" style="width:100%;display:none;object-fit:cover;">' : '<span style="font-family:Courier Prime,monospace;font-size:8px;color:rgba(160,130,70,.5);text-align:center;padding:8px;">No outfit plate on file</span>')
      + '</div>'
      + '<label style="font-family:Special Elite,monospace;font-size:8px;letter-spacing:.1em;text-transform:uppercase;background:transparent;color:#4a3f28;border:1px dashed rgba(160,130,70,.35);padding:4px 8px;cursor:pointer;display:block;width:100%;margin-top:2px;text-align:center;box-sizing:border-box;" for="upload-outfit-' + era + '">' + (outfitUrl ? 'Replace Outfit Plate' : 'Upload Outfit Plate') + '</label>'
      + '<input type="file" id="upload-outfit-' + era + '" accept="image/*" style="display:none" data-era="' + era + '" data-type="outfit" onchange="handlePlateUpload(this,this.dataset.era,this.dataset.type)">'
      + '</div>'
      + '</div>'
      // Prompts
      + '<div style="margin-bottom:16px;">'
      + '<div style="font-family:Special Elite,monospace;font-size:8px;letter-spacing:.15em;text-transform:uppercase;color:#8b1a1a;margin-bottom:8px;">Field Portrait Prompt</div>'
      + '<textarea id="prompt-mode0-' + era + '" style="width:100%;background:rgba(0,0,0,.04);border:none;border-left:2px solid rgba(160,130,70,.35);padding:8px 12px;font-family:Courier Prime,monospace;font-size:10px;line-height:1.7;color:#4a3f28;min-height:60px;resize:vertical;box-sizing:border-box;">' + (mode0||'') + '</textarea>'
      + '<div style="display:flex;gap:8px;margin-top:4px;">'
      + '<button data-era="' + era + '" data-mode="mode0" onclick="saveEraPrompt(this)" style="font-family:Special Elite,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;background:#1c1608;color:#f4eed8;border:none;padding:4px 10px;cursor:pointer;">Save</button>'
      + '<button data-target="prompt-mode0-' + era + '" onclick="copyPrompt(this.dataset.target)" style="font-family:Special Elite,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;background:transparent;color:#4a3f28;border:1px solid rgba(160,130,70,.35);padding:4px 10px;cursor:pointer;">Copy</button>'
      + '<button data-era="' + era + '" data-mode="mode0" onclick="generatePlateImage(this.dataset.era,this.dataset.mode,this)" style="font-family:Special Elite,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;background:transparent;color:#8b1a1a;border:1px solid rgba(139,26,26,.4);padding:4px 10px;cursor:pointer;">Generate Image</button>'
      + '<span id="prompt-mode0-status-' + era + '" style="font-family:Courier Prime,monospace;font-size:9px;font-style:italic;color:#8a7a5a;align-self:center;"></span>'
      + '</div>'
      + '</div>'
      + '<div style="margin-bottom:24px;">'
      + '<div style="font-family:Special Elite,monospace;font-size:8px;letter-spacing:.15em;text-transform:uppercase;color:#8b1a1a;margin-bottom:8px;">Field Reference Prompt</div>'
      + '<textarea id="prompt-mode1-' + era + '" style="width:100%;background:rgba(0,0,0,.04);border:none;border-left:2px solid rgba(160,130,70,.35);padding:8px 12px;font-family:Courier Prime,monospace;font-size:10px;line-height:1.7;color:#4a3f28;min-height:60px;resize:vertical;box-sizing:border-box;">' + (mode1||'') + '</textarea>'
      + '<div style="display:flex;gap:8px;margin-top:4px;">'
      + '<button data-era="' + era + '" data-mode="mode1" onclick="saveEraPrompt(this)" style="font-family:Special Elite,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;background:#1c1608;color:#f4eed8;border:none;padding:4px 10px;cursor:pointer;">Save</button>'
      + '<button data-target="prompt-mode1-' + era + '" onclick="copyPrompt(this.dataset.target)" style="font-family:Special Elite,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;background:transparent;color:#4a3f28;border:1px solid rgba(160,130,70,.35);padding:4px 10px;cursor:pointer;">Copy</button>'
      + '<button data-era="' + era + '" data-mode="mode1" onclick="generatePlateImage(this.dataset.era,this.dataset.mode,this)" title="' + (faceUrl ? 'Uses the Face Plate as a reference for character consistency' : 'Generate a Face Plate first -- the Outfit Plate uses it as a reference') + '" style="font-family:Special Elite,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;background:transparent;color:#8b1a1a;border:1px solid rgba(139,26,26,.4);padding:4px 10px;cursor:pointer;' + (faceUrl ? '' : 'opacity:.5;') + '">Generate Image</button>'
      + '<span id="prompt-mode1-status-' + era + '" style="font-family:Courier Prime,monospace;font-size:9px;font-style:italic;color:#8a7a5a;align-self:center;"></span>'
      + '</div>'
      + '</div>'
      // Divider + appearance
      + '<div style="border-top:1.5px dashed rgba(160,130,70,.35);margin:0 0 16px;"></div>'
      + '<div style="font-family:Special Elite,monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#8b1a1a;margin-bottom:12px;border-bottom:1px solid #8b1a1a;padding-bottom:4px;">Agent Appearance — ' + eraDecade[era] + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr;gap:0;">'
      + eraDataField('Build', data.build)
      + eraDataField('Facial Hair', data.facial_hair)
      + eraDataField('Hair', (data.hair_color||'') + (data.hair_style ? ' / ' + data.hair_style : ''))
      + eraDataField('Scars', data.face_scars)
      + eraDataField('Outfit', [data.jacket, data.shirt, data.trousers, data.footwear].filter(Boolean).join(' · '))
      + eraDataField('Accessories', [data.accessories, data.jewelry].filter(Boolean).join(' · '))
      + '</div>';

    item.appendChild(body);
    stack.appendChild(item);
    if (faceUrl) loadDriveImage(faceUrl, 'img-face-' + era);
    if (outfitUrl) loadDriveImage(outfitUrl, 'img-outfit-' + era);
    // Auto-generate prompts if missing -- checks THIS era's own columns
    // directly, not the mode0/mode1 fallback value used for display
    // above. That fallback exists so an Agent's pre-fix era still shows
    // its real legacy prompt; but for a genuinely NEW era with no
    // era-specific data yet, the same fallback would resolve to some
    // OTHER (unrecorded) era's stale flat value, make this check think
    // data already exists, and permanently skip generation -- the exact
    // cross-era leak this whole fix exists to prevent, just reached
    // through the read fallback instead of the old write collision.
    if (!data['era_' + era + '_mode0'] || !data['era_' + era + '_mode1']) {
      (function(capturedEra) {
        setTimeout(function() { autoGenerateEraPrompts(capturedEra); }, 500 + idx * 200);
      })(era);
    }
    afEraPages.push(era);
  });

  afActiveEra = eras[0];
  // Remove old min-height hack — accordion is natural height
  stack.style.minHeight = '';
  document.getElementById('af-add-era-btn').style.display = eras.length < 4 ? 'block' : 'none';
  updatePreviewBadges();
}

// face_plate_url is the Agent's main photo everywhere else (Hub card,
// Live Play tracker, A-Cell, Field ID, Field Notes) and is meant to be a
// copy of the Active Era's Face Plate -- but it was only ever set in a
// few narrow cases (a Plate made while its era was already active, or
// "Make Active Era" pressed after the Plate existed), and older versions
// never saved it at all (BUGFIXES: "Make Active Era never saved"). A real
// report: an Agent with two era photos and an Active Era, and no photo
// anywhere else. Every reader now works it out with dgStore.mainPhoto();
// this also repairs the stored copy whenever the Agent File loads the
// Agent from the server. An Active Era with no Plate yet clears a stale
// copy (matching setPreviewEra(): no photo, not another era's).
function healMainPhoto() {
  if (!afData || !afCode || !window.dgStore || !window.dgStore.mainPhoto) return;
  const want = window.dgStore.mainPhoto(afData);
  // Same photo, just a different link form (Drive link vs gdrive:ID): leave it.
  if (want === window.dgStore.photoRef(afData.face_plate_url)) return;
  afData.face_plate_url = want;
  persistAgent(afCode, afData);
  afFetch({ action: 'update_field', agent_code: afCode, token: agentToken(afCode), field: 'face_plate_url', value: want }).catch(() => {});
}

// Which era's Face Plate is the Agent's "preview" photo -- the one every
// OTHER surface (roster tray, Field ID card) shows via the flat
// face_plate_url field, since none of them know about the per-era
// columns. campaign_era records the explicit choice; before it's ever
// set, the first/oldest era (afEraPages[0]) is treated as the preview,
// matching what face_plate_url already held by default (era Plate/
// prompt data collision fix's own idx===0 fallback).
function updatePreviewBadges() {
  if (!afData) return;
  afEraPages.forEach(function (era) {
    const el = document.getElementById('era-preview-' + era);
    if (!el) return;
    // Available on every era regardless of whether its Face Plate
    // exists yet -- marking an era active ahead of generating its photo
    // is a real, useful order of operations, not just a display choice.
    const isPreview = afData.campaign_era ? (afData.campaign_era === era) : (afEraPages[0] === era);
    el.innerHTML = isPreview
      ? '<span style="font-family:Courier Prime,monospace;font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#8b1a1a;">Active Era</span>'
      : '<button type="button" data-era="' + era + '" onclick="event.stopPropagation();setPreviewEra(this.dataset.era)" style="white-space:nowrap;font-family:Courier Prime,monospace;font-size:8px;letter-spacing:.08em;text-transform:uppercase;background:transparent;color:#4a3f28;border:1px solid rgba(160,130,70,.4);padding:2px 6px;cursor:pointer;">Make Active Era</button>';
  });
}

function setPreviewEra(era) {
  if (!afData || !afCode) return;
  // May be '' if this era has no Face Plate yet -- that's fine, it just
  // means the preview surfaces (roster tray, Field ID card) show no
  // photo until one's added for this era, same as before this feature
  // existed for an Agent with no Face Plate at all.
  const faceUrl = afData['era_' + era + '_face_url'] || (afEraPages[0] === era ? afData.face_plate_url : '');
  afData.campaign_era = era;
  afData.face_plate_url = faceUrl;
  persistAgent(afCode, afData);
  updatePreviewBadges();
  afFetch({ action: 'update_field', agent_code: afCode, token: agentToken(afCode), field: 'campaign_era', value: era }).catch(() => {});
  afFetch({ action: 'update_field', agent_code: afCode, token: agentToken(afCode), field: 'face_plate_url', value: faceUrl }).catch(() => {});
}

function toggleEraAccordion(era) {
  const body = document.getElementById('era-body-' + era);
  const chevron = document.getElementById('era-chevron-' + era);
  const header = body ? body.previousElementSibling : null;
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.innerHTML = isOpen ? '&#9660;' : '&#9650;';
  if (header) header.style.borderBottom = isOpen ? '1px solid rgba(180,150,72,.3)' : '2px solid #1c1608';
  if (!isOpen) afActiveEra = era;
}

function eraDataField(key, val) {
  if (!val) return '';
  return '<div style="display:flex;border-bottom:1px solid rgba(180,150,72,.2);padding:6px 0;align-items:baseline;gap:8px;">'
    + '<span style="font-family:Courier Prime,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;color:#8a7a5a;min-width:90px;flex-shrink:0;">' + key + '</span>'
    + '<span style="font-family:Courier Prime,monospace;font-size:11px;color:#1c1608;line-height:1.5;flex:1;">' + val + '</span>'
    + '</div>';
}

/* ── Handle plate image upload ── */
function handlePlateUpload(input, era, type) {
  if (!input.files[0] || !afCode || input.disabled) return;
  const file = input.files[0];
  const r = new FileReader();
  r.onload = e => {
    const lbl = input.previousElementSibling;
    const doneLabel = type === 'face' ? 'Replace Face Plate' : 'Replace Outfit Plate';
    input.disabled = true;
    if (lbl) lbl.textContent = 'Uploading…';
    saveGeneratedPlate(e.target.result, era, type, type + '_' + era + '_' + file.name).then(function() {
      input.disabled = false;
      if (lbl) lbl.textContent = doneLabel;
    }).catch(function() {
      input.disabled = false;
      if (lbl) lbl.textContent = doneLabel;
    });
  };
  r.readAsDataURL(file);
}

// Shared by both a manual upload (above) and a Gemini-generated image
// (generatePlateImage() below) -- shows the image immediately, then
// uploads it to Firebase Storage (Phase 4) and saves the resulting URL
// through the existing save_plate action, one path regardless of
// whether the image came from a file picker or Gemini. Returns the
// Promise chain (previously fire-and-forget with no return value) so a
// caller that wants to guard against a double-submit -- Storage upload
// makes this take noticeably longer than the old plain POST did -- can
// wait for it, same reasoning as a-cell.html's Evidence/Track Library
// upload buttons after a live double-submit report there.
function saveGeneratedPlate(dataUrl, era, type, imageName) {
  const box = document.getElementById('plate-' + type + '-' + era);
  if (box) box.innerHTML = '<img src="' + dataUrl + '" style="width:100%;display:block;object-fit:cover;object-position:top center;">';
  if (type === 'face') {
    afRecentFacePlateDataUri[era] = dataUrl;
    // This era's header badge and its Outfit Plate "Generate Image"
    // button were both rendered from the Face Plate state at page load
    // and never updated -- right after generating (or uploading) a Face
    // Plate the header still said "No Photo Yet" and the Outfit button
    // stayed dimmed with a "Generate a Face Plate first" tooltip.
    const badge = document.getElementById('era-photo-' + era);
    if (badge) badge.innerHTML = '&#9679; Photo On File';
    const outfitBtn = document.querySelector('button[data-era="' + era + '"][data-mode="mode1"][onclick^="generatePlateImage"]');
    if (outfitBtn) {
      outfitBtn.style.opacity = '';
      outfitBtn.title = 'Uses the Face Plate as a reference for character consistency';
    }
  }
  // Era-specific (era Plate/prompt data collision fix) -- the old flat
  // face_plate_url/outfit_plate_url was shared by every era, so adding
  // a second era silently overwrote the first era's Plate.
  const fieldKey = 'era_' + era + '_' + (type === 'face' ? 'face_url' : 'outfit_url');
  const charName = afData ? afData.char_name || afCode : afCode;
  const mime = dataUrl.split(';')[0].split(':')[1] || 'image/png';
  const ext = '.' + (mime.split('/')[1] || 'png');
  return ensureAgentSignedIn(afCode).then(function () {
    return fetch(dataUrl);
  }).then(function (res) {
    return res.blob();
  }).then(function (blob) {
    return window.firebase.storage().ref('agent-plates/' + afCode + '-' + type + '-' + era + ext).put(blob, { contentType: mime });
  }).then(function (snapshot) {
    return snapshot.ref.getDownloadURL();
  }).then(function (storageUrl) {
    // Keep this session's own copy current too, so anything read from
    // afData afterwards (the Outfit Plate's reference-image fallback,
    // a re-render of this era stack) sees the Plate that now exists.
    if (afData) afData[fieldKey] = storageUrl;
    // The Agent's main photo (face_plate_url -- Agent Hub's roster card,
    // Live Play's tracker photo, A-Cell) was only ever set by "Make
    // Active Era". A new player's first era is already shown as the
    // Active Era, so they never press it -- and generating or uploading
    // its Face Plate left the Hub saying "Take Photo" for good. A Face
    // Plate for the era that's currently active is the main photo.
    if (afData && type === 'face' && (afData.campaign_era || afEraPages[0]) === era) {
      afData.face_plate_url = storageUrl;
      afFetch({ action: 'update_field', agent_code: afCode, token: agentToken(afCode), field: 'face_plate_url', value: storageUrl }).catch(() => {});
      persistAgent(afCode, afData);
    }
    return afFetch({
        action: 'save_plate',
        agent_code: afCode,
        token: agentToken(afCode),
        field: fieldKey,
        storage_url: storageUrl,
        image_name: imageName || (type + '_' + era + '_generated.png'),
        char_name: charName
      });
  }).catch(e => { console.error('Plate save:', e); throw e; });
}

// Renders a Face/Outfit Plate image server-side (Gemini) from whatever's
// currently in the prompt textarea, then saves it exactly like a manual
// upload via saveGeneratedPlate() above.
// Fetches a gdrive:-prefixed (or share-link) image through the same
// imgdata JSONP proxy loadDriveImage() uses for on-page previews, but as
// a Promise resolving to a data URI (or null) instead of setting an
// <img>'s src -- so it can be attached to a generate_plate_image request
// as a reference image rather than just displayed.
function fetchDriveImageAsDataUri(url) {
  if (isDirectImageUrl_(url)) {
    // Storage-hosted: read the bytes directly if the bucket allows a
    // cross-origin GET; if it doesn't (no CORS headers -- see
    // table-radio.js), resolve null and let the caller hand the URL to
    // the backend instead (reference_image_url, fetched server-side).
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve) {
        const fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { resolve(null); };
        fr.readAsDataURL(blob);
      });
    }).catch(function () { return null; });
  }
  return new Promise(function(resolve) {
    const id = extractDriveId(url);
    if (!id) { resolve(null); return; }
    const cbName = '_refImg_' + id.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now();
    const scriptId = '_ds_' + cbName;
    window[cbName] = function(json) {
      delete window[cbName];
      const s = document.getElementById(scriptId);
      if (s) s.remove();
      resolve(json.status === 'OK' && json.dataUri ? json.dataUri : null);
    };
    const s = document.createElement('script');
    s.id = scriptId;
    s.src = APPS_SCRIPT_URL + '?action=imgdata&id=' + encodeURIComponent(id) + '&callback=' + cbName;
    s.onerror = function() { delete window[cbName]; resolve(null); };
    document.head.appendChild(s);
  });
}

function generatePlateImage(era, mode, btn) {
  if (btn && btn.disabled) return;
  const type = mode === 'mode0' ? 'face' : 'outfit';
  const ta = document.getElementById('prompt-' + mode + '-' + era);
  const st = document.getElementById('prompt-' + mode + '-status-' + era);
  if (!ta || !afCode) return;
  const prompt = ta.value.trim();
  if (!prompt) { if (st) st.textContent = 'Write or generate a prompt first.'; return; }

  // Same idx===0 gating as renderEraStack()'s own display fallback (see
  // its comment) -- afEraPages[0] is the first/only era on a pre-fix
  // Agent, the only one the flat legacy face_plate_url could actually
  // belong to. Without this, generating an Outfit Plate for a second+
  // era (still genuinely blank) would silently pass this era's own
  // "no Face Plate yet" gate using some OTHER era's leftover face as
  // the reference -- wrong likeness, and the gate meant to prevent
  // exactly that never fires.
  const faceUrl = afData ? (afData['era_' + era + '_face_url'] || (afEraPages[0] === era ? afData.face_plate_url : '') || '') : '';
  const recentFaceDataUri = afRecentFacePlateDataUri[era];

  // Outfit Plate depends on the Face Plate for likeness -- require it to
  // exist first rather than silently generating a face-less (and
  // therefore inconsistent) full-body shot.
  if (type === 'outfit' && !faceUrl && !recentFaceDataUri) {
    if (st) st.textContent = 'Generate a Face Plate first, so the Outfit Plate can match it.';
    return;
  }

  if (st) st.textContent = 'Generating image…';

  // Guard against a double-submit -- this now includes a Storage upload
  // (saveGeneratedPlate()) after the Gemini call, the same slow-async +
  // easy-to-miss-status combination that caused real duplicate uploads
  // on a-cell.html's Evidence form.
  const btnLabel = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
  function reenable() { if (btn) { btn.disabled = false; btn.textContent = btnLabel; } }

  // plate_type: the function asks Gemini for a tall full-body frame for an
  // Outfit Plate (functions/index.js generatePlateImage).
  const payload = { action: 'generate_plate_image', agent_code: afCode, token: agentToken(afCode), prompt: prompt, plate_type: type };

  function send() {
    afFetch(payload)
    .then(function(r) { return r.json(); })
    .then(function(json) {
      if (json.status === 'OK' && json.image_base64) {
        return saveGeneratedPlate(json.image_base64, era, type).then(function() {
          if (st) { st.textContent = 'Image generated.'; setTimeout(function(){ st.textContent=''; }, 3000); }
          reenable();
        });
      } else {
        if (st) st.textContent = 'Error: ' + (json.message || 'generation failed');
        reenable();
      }
    })
    .catch(function() { if (st) st.textContent = 'Error.'; reenable(); });
  }

  if (type === 'outfit') {
    // Outfit Plate: pass the existing Face Plate image as a reference so
    // the generated full-body shot keeps the same face instead of Gemini
    // inventing one. Prefer a Face Plate generated/uploaded earlier this
    // session (afRecentFacePlateDataUri) -- saveGeneratedPlate() is a
    // fire-and-forget no-cors POST with no response to read back, so
    // afData.face_plate_url stays stale until the next full page load,
    // and relying on whatever <img id="img-face-ERA"> happens to hold
    // broke too (that element gets replaced, dropping its id, every time
    // a Face Plate is generated or uploaded). Falling back to a fresh
    // Drive fetch covers a Face Plate from an earlier session instead.
    (recentFaceDataUri ? Promise.resolve(recentFaceDataUri) : fetchDriveImageAsDataUri(faceUrl)).then(function(dataUri) {
      if (!dataUri && isDirectImageUrl_(faceUrl)) payload.reference_image_url = faceUrl;
      if (dataUri || payload.reference_image_url) {
        if (dataUri) payload.reference_image_base64 = dataUri;
        // The reference here is the existing Face Plate -- a tight
        // forehead-to-chest headshot by Mode 0's own framing. Gemini's
        // image-to-image generation otherwise anchors hard on the
        // reference's composition, not just the face in it, so without
        // this override the "full body" instructions above still come
        // back cropped like a headshot -- a Face Plate wearing the
        // right clothes instead of an actual full-body shot.
        payload.prompt += '\n\nIMPORTANT: The attached reference image is ONLY for facial identity and likeness -- completely ignore its framing, crop, and camera distance. The output MUST be a full-body image with the entire figure visible from head to feet, matching the framing instructions above, not a headshot or close-up crop.';
      }
      send();
    });
  } else if (type === 'face' && afData && afData.ref_image_link) {
    // Face Plate: the player's own optional "Resembles" reference photo
    // from Profiling (ref_image_link) is exactly what that field is
    // for -- give Gemini the actual likeness reference alongside the
    // text description instead of working from the description alone.
    fetchDriveImageAsDataUri(afData.ref_image_link).then(function(dataUri) {
      if (dataUri) payload.reference_image_base64 = dataUri;
      else if (isDirectImageUrl_(afData.ref_image_link)) payload.reference_image_url = afData.ref_image_link;
      send();
    });
  } else {
    send();
  }
}

/* ── Per-era age adjustment: an Agent's age_range is entered once, for
   whichever era the player actually means it to describe. Real player
   report: registering at 40s in the 2020s should describe her as in
   her 20s in a 2000s portrait, not still 40s -- every era's prompt was
   using the same flat age_range regardless of how many years before/
   after registration that era actually is. ── */
const ERA_YEAR_ = {'90s':1990,'00s':2000,'10s':2010,'20s':2020};
function ageRangeToYears_(label) {
  if (!label) return null;
  if (/60s or older/i.test(label)) return 62; // representative point for the open-ended top bracket
  const m = /^(Early|Mid|Late)\s+(\d)0s$/i.exec(label.trim());
  if (!m) return null; // an unrecognized/legacy value -- leave age adjustment out rather than guess
  const decade = parseInt(m[2], 10) * 10;
  const sub = { early: 2, mid: 5, late: 8 }[m[1].toLowerCase()];
  return decade + sub;
}
function yearsToAgeRangeLabel_(years) {
  years = Math.round(years);
  if (years >= 60) return '60s or older';
  if (years < 21) years = 21; // floor -- youngest real option is Early 20s
  const decade = Math.floor(years / 10) * 10;
  const sub = years - decade;
  const bucket = sub <= 3 ? 'Early' : (sub <= 6 ? 'Mid' : 'Late');
  return bucket + ' ' + decade + 's';
}
// The reference era is the explicit "Active Era" (campaign_era, set via
// the Make Active Era button -- see updatePreviewBadges()/setPreviewEra()
// just above, whose own campaign_era-or-afEraPages[0] fallback this
// matches) -- age_range is meant to describe the Agent as of THAT era,
// which is also the one place a player deliberately says "this is my
// reference point" rather than it being inferred from creation order.
// Before an Active Era is ever explicitly chosen, falls back to
// whichever era was rendered first this load (afEraPages is fully
// populated by the time this runs -- it's built synchronously across
// renderEraStack()'s whole forEach before any of its staggered
// setTimeout-deferred autoGenerateEraPrompts() calls can fire), with a
// parseEras() fallback for the one call site that runs before any era
// has rendered at all (initEra() on a brand-new Agent's very first era).
function ageRangeForEra_(era) {
  const raw = afData && afData.age_range || '';
  if (!raw) return raw;
  const refEra = (afData && afData.campaign_era) ||
    ((afEraPages && afEraPages.length) ? afEraPages[0] : ((parseEras(afData || {})[0]) || era));
  if (refEra === era || !ERA_YEAR_[refEra] || !ERA_YEAR_[era]) return raw;
  const baseYears = ageRangeToYears_(raw);
  if (baseYears === null) return raw;
  return yearsToAgeRangeLabel_(baseYears + (ERA_YEAR_[era] - ERA_YEAR_[refEra]));
}

/* ── AUTO-GENERATE ERA PROMPTS ── */
function autoGenerateEraPrompts(era) {
  if (!afData || !afCode) return;

  const ta0 = document.getElementById('prompt-mode0-' + era);
  const ta1 = document.getElementById('prompt-mode1-' + era);
  const st0 = document.getElementById('prompt-mode0-status-' + era);
  const st1 = document.getElementById('prompt-mode1-status-' + era);
  if (!ta0 || !ta1) return;

  // Checks THIS era's own columns directly, same reasoning as
  // renderEraStack()'s own outer guard right above its call to this
  // function -- ta0.value/ta1.value at this point is whatever
  // renderEraStack() just rendered into the textarea, which for a
  // brand-new era with no era-specific data yet is the display
  // fallback's merged value (some OTHER, unrecorded era's stale flat
  // prompt), not actually empty. Checking that instead of afData
  // directly used to make this function think a genuinely-blank new
  // era already had data and silently skip generation.
  const needsPortrait = !afData['era_' + era + '_mode0'];
  const needsReference = !afData['era_' + era + '_mode1'];
  if (!needsPortrait && !needsReference) return;

  const character = {
    age_range: ageRangeForEra_(era), sex: afData.sex||'', nationality: afData.nationality||'',
    build: afData.build||'', posture: afData.posture||'', face_shape: afData.face_shape||'',
    eye_color: afData.eye_color||'', eye_shape: afData.eye_shape||'', nose: afData.nose||'',
    lips: afData.lips||'', skin: afData.skin||'', facial_hair: afData.facial_hair||'',
    face_scars: afData.face_scars||'', hair_color: afData.hair_color||'',
    hair_style: afData.hair_style||'', hair_texture: afData.hair_texture||'',
    body_markers: afData.body_markers||'', jacket: afData.jacket||'',
    shirt: afData.shirt||'', trousers: afData.trousers||'', footwear: afData.footwear||'',
    accessories: afData.accessories||'', jewelry: afData.jewelry||'',
    expression: afData.expression||'', vibe: afData.vibe||''
  };

  if (needsPortrait && st0) st0.textContent = 'Generating\u2026';
  if (needsReference && st1) st1.textContent = 'Generating\u2026';

  // era wasn't actually being sent here despite the backend already
  // having per-era wardrobe styling logic (eraOutfitContext in
  // generateAppearancePrompt(), backend/Code.gs) waiting for it -- every
  // era's prompt was generated with no period cue at all, which read as
  // "always styled like whichever era the AI defaults to" instead of
  // actually matching the era tab it was generated for.

  // Generate Field Portrait (mode: base = headshot)
  if (needsPortrait) {
    afFetch({ action: 'generate_prompt', agent_code: afCode, token: agentToken(afCode), character: character, injuries: [], mode: 'base', era: era })
    .then(function(r) { return r.json(); })
    .then(function(json) {
      if (json.status === 'OK' && json.prompt) {
        ta0.value = json.prompt;
        if (st0) { st0.textContent = 'Generated.'; setTimeout(function(){ st0.textContent=''; }, 3000); }
        // Save to Sheet
        afFetch({ action:'update_field', agent_code: afCode, token: agentToken(afCode), field: 'era_' + era + '_mode0', value: json.prompt }).catch(function(e){ console.error(e); });
        if (afData) afData['era_' + era + '_mode0'] = json.prompt;
        persistAgent(afCode, afData);
      } else {
        // Was a bare "Error." with no way to tell a real failure apart
        // from a rate limit (checkRateLimit_() in Code.gs, 10 prompt
        // generations per 10 minutes per Agent -- easy to hit just from
        // adding several eras at once, each needing up to two of these
        // calls) -- surfaces json.message now, same as
        // generatePlateImage()'s own error text already does.
        if (st0) st0.textContent = 'Error: ' + (json.message || 'generation failed');
      }
    })
    .catch(function() { if (st0) st0.textContent = 'Error: connection failed.'; });
  }

  // Generate Field Reference (mode: outfit = full body with outfit)
  if (needsReference) {
    afFetch({ action: 'generate_prompt', agent_code: afCode, token: agentToken(afCode), character: character, injuries: [], mode: 'outfit', era: era })
    .then(function(r) { return r.json(); })
    .then(function(json) {
      if (json.status === 'OK' && json.prompt) {
        ta1.value = json.prompt;
        if (st1) { st1.textContent = 'Generated.'; setTimeout(function(){ st1.textContent=''; }, 3000); }
        afFetch({ action:'update_field', agent_code: afCode, token: agentToken(afCode), field: 'era_' + era + '_mode1', value: json.prompt }).catch(function(e){ console.error(e); });
        if (afData) afData['era_' + era + '_mode1'] = json.prompt;
        persistAgent(afCode, afData);
      } else {
        // See the mode0 branch above's comment -- same fix.
        if (st1) st1.textContent = 'Error: ' + (json.message || 'generation failed');
      }
    })
    .catch(function() { if (st1) st1.textContent = 'Error: connection failed.'; });
  }
}

function saveEraPrompt(btn) {
  const era = btn.dataset.era;
  const mode = btn.dataset.mode;
  const textarea = document.getElementById('prompt-' + mode + '-' + era);
  const status = document.getElementById('prompt-' + mode + '-status-' + era);
  if (!textarea || !afCode) return;
  const val = textarea.value.trim();
  if (!val) return;
  if (status) status.textContent = 'Saving…';
  // Map mode to sheet field name -- era-specific (era Plate/prompt data
  // collision fix), not the shared flat mode0_prompt/mode1_prompt every
  // era used to silently overwrite.
  const fieldMap = {'mode0': 'era_' + era + '_mode0', 'mode1': 'era_' + era + '_mode1'};
  const field = fieldMap[mode];
  afFetch({ action: 'update_field', agent_code: afCode, token: agentToken(afCode), field: field, value: val }).then(() => {
    if (status) { status.textContent = 'Saved.'; setTimeout(() => status.textContent = '', 2500); }
    if (afData) afData[field] = val;
  }).catch(() => { if (status) status.textContent = 'Error.'; });
}

function copyPrompt(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.tagName === 'TEXTAREA' ? el.value.trim() : el.textContent.replace('Copy','').trim();
  navigator.clipboard.writeText(text);
}

/* ── Medical entries ── */
let medPhotoDataUrl = null;
let medFormVisible = false;

function renderMedicalEntries(data) {
  const container = document.getElementById('medical-entries');
  // Medical entries stored as JSON in sheet field 'medical_log'
  const entries = (data.medical_log && data.medical_log !== '') ? (() => { try { return JSON.parse(data.medical_log); } catch(e) { return []; } })() : [];

  if (entries.length === 0) {
    container.innerHTML = '<div class="med-no-data">No medical incidents on file.</div>';
    return;
  }

  container.innerHTML = entries.map((e, idx) => {
    const sevColors = {
      minor:    'background:#e8f5e8;color:#1a4a1a;border:1.5px solid #1a4a1a;',
      moderate: 'background:#fff5e0;color:#6a4a00;border:1.5px solid #c8a040;',
      severe:   'background:#fde8e8;color:#6a1a1a;border:1.5px solid #8b1a1a;',
      critical: 'background:#1a0a0a;color:#ffaaaa;border:1.5px solid #8b1a1a;'
    };
    const sevStyle = sevColors[e.severity] || sevColors.minor;
    const existingPrompt = e.appearance_prompt || '';
    return '<div class="med-entry" id="med-entry-' + idx + '">'
      + '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;background:rgba(255,255,255,.3);border-bottom:1px solid transparent;" onclick="toggleMedAccordion(' + idx + ')">'
      + '<span style="font-family:Special Elite,monospace;font-size:8px;letter-spacing:.12em;text-transform:uppercase;padding:3px 8px;border-radius:2px;display:inline-block;white-space:nowrap;flex-shrink:0;' + sevStyle + '">' + (e.severity || 'minor') + '</span>'
      + '<span style="font-family:Courier Prime,monospace;font-size:10px;color:#4a3f28;">' + (e.date || '') + '</span>'
      + '<span style="font-family:Courier Prime,monospace;font-size:11px;color:#1c1608;font-weight:700;">' + (e.body_part || '') + '</span>'
      + '<span style="margin-left:auto;font-size:14px;color:#8a7a5a;" id="med-toggle-' + idx + '">▾</span>'
      + '</div>'
      + '<div id="med-body-' + idx + '" style="display:none;padding:12px;">'
      + (e.photo ? '<img style="width:100%;max-height:160px;object-fit:cover;margin-bottom:8px;border:1px solid rgba(160,130,70,.35);" src="' + e.photo + '" alt="Medical reference">' : '')
      + '<div style="display:flex;border-bottom:1px solid rgba(180,150,72,.2);padding:6px 0;align-items:baseline;gap:8px;"><span style="font-family:Courier Prime,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;color:#8a7a5a;min-width:90px;flex-shrink:0;">Injury</span><span style="font-family:Courier Prime,monospace;font-size:11px;color:#1c1608;line-height:1.5;flex:1;">' + (e.injury || '') + '</span></div>'
      + '<div style="display:flex;border-bottom:1px solid rgba(180,150,72,.2);padding:6px 0;align-items:baseline;gap:8px;"><span style="font-family:Courier Prime,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;color:#8a7a5a;min-width:90px;flex-shrink:0;">Description</span><span style="font-family:Courier Prime,monospace;font-size:11px;color:#1c1608;line-height:1.5;flex:1;">' + (e.description || '') + '</span></div>'
      + (e.appearance ? '<div style="background:rgba(139,26,26,.06);border-left:2px solid #8b1a1a;padding:8px 12px;font-family:Courier Prime,monospace;font-size:10px;line-height:1.6;color:#1c1608;margin-top:8px;font-style:italic;">APPEARANCE IMPACT: ' + e.appearance + '</div>' : '')
      + '<div style="border-top:1px dashed rgba(160,130,70,.3);margin-top:12px;padding-top:12px;">'
      + '<div style="font-family:Special Elite,monospace;font-size:8px;letter-spacing:.15em;text-transform:uppercase;color:#8b1a1a;margin-bottom:8px;">Current Appearance Prompt</div>'
      + '<div id="med-prompt-box-' + idx + '" style="background:rgba(0,0,0,.04);border-left:2px solid rgba(160,130,70,.35);padding:8px 12px;font-family:Courier Prime,monospace;font-size:10px;line-height:1.7;color:#4a3f28;min-height:40px;white-space:pre-wrap;word-break:break-word;margin-bottom:8px;">'
      + (existingPrompt || '<span style="color:#b8a878;font-style:italic;">No prompt generated yet.</span>')
      + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'
      + '<button data-idx="' + idx + '" onclick="generateMedPrompt(this)" style="font-family:Special Elite,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;background:#1c1608;color:#f4eed8;border:none;padding:5px 12px;cursor:pointer;">Generate</button>'
      + '<button data-idx="' + idx + '" onclick="copyMedPrompt(this)" style="font-family:Special Elite,monospace;font-size:7px;letter-spacing:.1em;text-transform:uppercase;background:transparent;color:#4a3f28;border:1px solid rgba(160,130,70,.35);padding:5px 12px;cursor:pointer;">Copy</button>'
      + '<span id="med-prompt-status-' + idx + '" style="font-family:Courier Prime,monospace;font-size:9px;font-style:italic;color:#8a7a5a;"></span>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function toggleMedAccordion(idx) {
  const body = document.getElementById('med-body-' + idx);
  const toggle = document.getElementById('med-toggle-' + idx);
  if (!body) return;
  const isOpen = body.style.display === 'block';
  body.style.display = isOpen ? 'none' : 'block';
  if (toggle) toggle.innerHTML = isOpen ? '▾' : '▴';
}

/* ── MEDICAL APPEARANCE PROMPT ── */
function generateMedPrompt(btn) {
  if (!afData || !afCode) return;
  const idx = parseInt(btn.dataset.idx);
  const box = document.getElementById('med-prompt-box-' + idx);
  const status = document.getElementById('med-prompt-status-' + idx);
  if (!box || !status) return;
  const entries = (afData.medical_log && afData.medical_log !== '')
    ? (() => { try { return JSON.parse(afData.medical_log); } catch(e) { return []; } })()
    : [];
  const injuries = entries
    .filter(function(e) { return e.appearance || e.injury; })
    .map(function(e) { return { body_part: e.body_part, injury: e.injury, appearance: e.appearance || '' }; });
  const character = {
    age_range: afData.age_range||'', sex: afData.sex||'', nationality: afData.nationality||'',
    build: afData.build||'', posture: afData.posture||'', face_shape: afData.face_shape||'',
    eye_color: afData.eye_color||'', eye_shape: afData.eye_shape||'', nose: afData.nose||'',
    lips: afData.lips||'', skin: afData.skin||'', facial_hair: afData.facial_hair||'',
    face_scars: afData.face_scars||'', hair_color: afData.hair_color||'',
    hair_style: afData.hair_style||'', hair_texture: afData.hair_texture||'',
    body_markers: afData.body_markers||''
  };
  btn.disabled = true;
  btn.textContent = 'Generating…';
  status.textContent = '';
  box.innerHTML = '<span style="color:#b8a878;font-style:italic;">Generating prompt…</span>';
  afFetch({ action: 'generate_prompt', agent_code: afCode, token: agentToken(afCode), character: character, injuries: injuries })
  .then(function(r) { return r.json(); })
  .then(function(json) {
    btn.disabled = false;
    btn.textContent = 'Regenerate';
    if (json.status === 'OK' && json.prompt) {
      box.textContent = json.prompt;
      status.textContent = 'Done.';
      setTimeout(function() { status.textContent = ''; }, 3000);
      entries[idx].appearance_prompt = json.prompt;
      afData.medical_log = JSON.stringify(entries);
      persistAgent(afCode, afData);
      afFetch({ action: 'update_medical', agent_code: afCode, token: agentToken(afCode), medical_log: afData.medical_log }).catch(function(e) { console.error(e); });
    } else {
      box.innerHTML = '<span style="color:#8b1a1a;font-style:italic;">Error: ' + (json.message || 'Unknown') + '</span>';
      btn.textContent = 'Retry';
    }
  })
  .catch(function() {
    btn.disabled = false;
    btn.textContent = 'Retry';
    box.innerHTML = '<span style="color:#8b1a1a;font-style:italic;">Connection error. Try again.</span>';
  });
}

function copyMedPrompt(btn) {
  const idx = parseInt(btn.dataset.idx);
  const box = document.getElementById('med-prompt-box-' + idx);
  if (!box || !box.textContent.trim()) return;
  navigator.clipboard.writeText(box.textContent.trim()).then(function() {
    const status = document.getElementById('med-prompt-status-' + idx);
    if (status) { status.textContent = 'Copied!'; setTimeout(function() { status.textContent = ''; }, 2000); }
  });
}

/* ── MEDICAL FORM PROMPT (inside add form, before save) ── */
function generateMedFormPrompt() {
  if (!afData) return;
  const btn = document.getElementById('med-form-gen-btn');
  const status = document.getElementById('med-form-gen-status');
  const ta = document.getElementById('med-form-prompt');
  if (!btn || !ta) return;

  const bodyPart = document.getElementById('med-body-part').value.trim();
  const injury = document.getElementById('med-injury').value.trim();
  const appearance = document.getElementById('med-appearance').value.trim();

  if (!injury && !appearance) {
    if(status) status.textContent = 'Fill in injury and appearance impact first.';
    return;
  }

  // Collect all existing injuries plus this new one
  const existing = (afData.medical_log && afData.medical_log !== '')
    ? (() => { try { return JSON.parse(afData.medical_log); } catch(e) { return []; } })()
    : [];
  const allInjuries = existing
    .filter(function(e) { return e.appearance || e.injury; })
    .map(function(e) { return { body_part: e.body_part, injury: e.injury, appearance: e.appearance || '' }; });
  // Add the current unsaved entry
  if (injury || appearance) {
    allInjuries.push({ body_part: bodyPart || 'unspecified', injury: injury, appearance: appearance });
  }

  const character = {
    age_range: afData.age_range||'', sex: afData.sex||'', nationality: afData.nationality||'',
    build: afData.build||'', posture: afData.posture||'', face_shape: afData.face_shape||'',
    eye_color: afData.eye_color||'', eye_shape: afData.eye_shape||'', nose: afData.nose||'',
    lips: afData.lips||'', skin: afData.skin||'', facial_hair: afData.facial_hair||'',
    face_scars: afData.face_scars||'', hair_color: afData.hair_color||'',
    hair_style: afData.hair_style||'', hair_texture: afData.hair_texture||'',
    body_markers: afData.body_markers||''
  };

  btn.disabled = true;
  btn.textContent = 'Generating…';
  if(status) status.textContent = '';
  ta.value = '';
  ta.placeholder = 'Generating…';

  afFetch({ action: 'generate_prompt', agent_code: afCode, token: agentToken(afCode), character: character, injuries: allInjuries })
  .then(function(r) { return r.json(); })
  .then(function(json) {
    btn.disabled = false;
    btn.textContent = 'Regenerate';
    ta.placeholder = 'Generated appearance prompt will appear here…';
    if (json.status === 'OK' && json.prompt) {
      ta.value = json.prompt;
      if(status) { status.textContent = 'Done — copy and generate the image, then upload below.'; }
    } else {
      if(status) status.textContent = 'Error: ' + (json.message || 'Unknown');
    }
  })
  .catch(function() {
    btn.disabled = false;
    btn.textContent = 'Generate Prompt';
    ta.placeholder = 'Generated appearance prompt will appear here…';
    if(status) status.textContent = 'Connection error.';
  });
}

function copyMedFormPrompt() {
  const ta = document.getElementById('med-form-prompt');
  if (!ta || !ta.value.trim()) return;
  navigator.clipboard.writeText(ta.value.trim()).then(function() {
    const status = document.getElementById('med-form-gen-status');
    if(status) { status.textContent = 'Copied!'; setTimeout(function(){ status.textContent = 'Done — copy and generate the image, then upload below.'; }, 2000); }
  });
}

function toggleMedForm() {
  medFormVisible = !medFormVisible;
  document.getElementById('med-add-form').style.display = medFormVisible ? 'block' : 'none';
  if (!medFormVisible) {
    const ta = document.getElementById('med-form-prompt');
    if (ta) { ta.value = ''; ta.placeholder = 'Generated appearance prompt will appear here — copy it to your image tool, then upload the result below.'; }
    const status = document.getElementById('med-form-gen-status');
    if (status) status.textContent = '';
    const btn = document.getElementById('med-form-gen-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Prompt'; }
  }
}

function handleMedPhoto(input) {
  if (!input.files[0]) return;
  const r = new FileReader();
  r.onload = e => {
    medPhotoDataUrl = e.target.result;
    const prev = document.getElementById('med-photo-prev');
    prev.src = e.target.result; prev.style.display = 'block';
  };
  r.readAsDataURL(input.files[0]);
}

function saveMedEntry() {
  if (!afCode) return;
  const status = document.getElementById('med-save-status');
  const entry = {
    date: document.getElementById('med-date').value,
    severity: document.getElementById('med-severity').value,
    body_part: document.getElementById('med-body-part').value,
    injury: document.getElementById('med-injury').value,
    description: document.getElementById('med-desc').value,
    appearance: document.getElementById('med-appearance').value,
    appearance_prompt: (document.getElementById('med-form-prompt')?.value || '').trim(),
    photo: medPhotoDataUrl || null
  };

  if (!entry.body_part || !entry.injury) {
    status.textContent = 'Fill in affected area and nature of injury.';
    return;
  }

  status.textContent = 'Saving…';

  // Build existing + new log
  const existing = (afData?.medical_log && afData.medical_log !== '') ? (() => { try { return JSON.parse(afData.medical_log); } catch(e) { return []; } })() : [];
  existing.push(entry);
  const payload = {
    action: 'update_medical',
    agent_code: afCode,
    token: agentToken(afCode),
    medical_log: JSON.stringify(existing)
  };

  afFetch(payload).then(() => {
    status.textContent = 'Entry filed.';
    if (!afData) afData = {};
    afData.medical_log = JSON.stringify(existing);
    renderMedicalEntries(afData);
    toggleMedForm();
    medPhotoDataUrl = null;
  }).catch(() => {
    status.textContent = 'Error — try again.';
  });
}

/* ── After-Action Reports ── */
let aarPhotoDataUrl = null;
let aarFormVisible = false;

function renderAarEntries(data) {
  const container = document.getElementById('aar-entries');
  const entries = (data.aar_log && data.aar_log !== '') ? (() => { try { return JSON.parse(data.aar_log); } catch(e) { return []; } })() : [];

  if (entries.length === 0) {
    container.innerHTML = '<div class="af-no-data">No after-action reports on file.</div>';
    return;
  }

  const rotations = ['-1.5deg','1deg','-0.5deg','1.8deg','-1deg','0.7deg'];
  container.innerHTML = entries.map((e, idx) => `
    <div class="aar-card" onclick="openAarDetail(${idx})">
      <div class="aar-polaroid" style="--pol-rot:${rotations[idx % rotations.length]}">
        ${e.photo
          ? `<img src="${e.photo}" alt="${e.operation}">`
          : `<div class="aar-polaroid-empty">No photo on file</div>`}
        <div class="aar-polaroid-caption">${e.location || '—'}</div>
      </div>
      <div class="aar-card-meta">
        <div class="aar-card-op">${e.operation}</div>
        <div class="aar-card-date">${e.date}</div>
      </div>
    </div>
  `).join('');
}

function openAarDetail(idx) {
  const entries = afData?.aar_log ? JSON.parse(afData.aar_log) : [];
  const e = entries[idx];
  if (!e) return;

  document.getElementById('aar-detail-op').textContent = e.operation || 'Unknown Operation';
  document.getElementById('aar-detail-meta').textContent = [e.date, e.location].filter(Boolean).join('   ·   ');

  const photoEl = document.getElementById('aar-detail-photo');
  if (e.photo) { photoEl.src = e.photo; photoEl.style.display = 'block'; }
  else { photoEl.removeAttribute('src'); photoEl.style.display = 'none'; }

  document.getElementById('aar-detail-scene').textContent = e.scene || '';

  const promptBox = document.getElementById('aar-detail-prompt-box');
  if (e.cinematic_prompt) {
    document.getElementById('aar-detail-prompt').textContent = e.cinematic_prompt;
    promptBox.style.display = 'block';
  } else {
    promptBox.style.display = 'none';
  }

  document.getElementById('aar-detail-overlay').classList.add('open');
}

function closeAarDetail() {
  document.getElementById('aar-detail-overlay').classList.remove('open');
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAarDetail();
});

function toggleAarForm() {
  aarFormVisible = !aarFormVisible;
  document.getElementById('aar-add-form').style.display = aarFormVisible ? 'block' : 'none';
}

function handleAarPhoto(input) {
  if (!input.files[0]) return;
  const r = new FileReader();
  r.onload = e => {
    aarPhotoDataUrl = e.target.result;
    const prev = document.getElementById('aar-photo-prev');
    prev.src = e.target.result; prev.style.display = 'block';
  };
  r.readAsDataURL(input.files[0]);
}

let debriefGenerating = false;
function generateDebriefPrompt() {
  if (debriefGenerating) return;
  const scene = document.getElementById('aar-scene').value.trim();
  if (!scene) {
    document.getElementById('co-debrief-content').textContent = 'Write a scene description first.';
    return;
  }

  debriefGenerating = true;
  const btn = document.querySelector('.co-debrief-btn');
  const content = document.getElementById('co-debrief-content');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  content.textContent = '…';

  // Build character context from loaded agent data
  const charContext = afData ? `Character: ${afData.char_name || 'Unknown'}, ${afData.age_range || ''}, ${afData.build || ''}, ${afData.expression || ''}. Outfit: ${afData.jacket || ''} ${afData.shirt || ''} ${afData.trousers || ''} ${afData.footwear || ''}.` : '';

  fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are a Delta Green cinematic prompt writer for Banana Pro / Higgsfield AI. Convert this scene description into a precise, photorealistic cinema prompt. ${charContext}\n\nScene: ${scene}\n\nWrite only the prompt, nothing else. Focus on: lighting, camera angle, character positioning, environmental details, film stock aesthetic. 2-3 paragraphs maximum.`
      }]
    })
  })
  .then(r => r.json())
  .then(data => {
    const text = data.content?.[0]?.text || 'Could not generate prompt.';
    content.textContent = text;
    btn.disabled = false;
    btn.textContent = 'Regenerate';
    debriefGenerating = false;
  })
  .catch(() => {
    content.textContent = 'Generation failed. Check your connection.';
    btn.disabled = false;
    btn.textContent = 'Try Again';
    debriefGenerating = false;
  });
}

function saveAarEntry() {
  if (!afCode) return;
  const status = document.getElementById('aar-save-status');
  const debriefPrompt = document.getElementById('co-debrief-content').textContent;

  const entry = {
    date: document.getElementById('aar-date').value,
    operation: document.getElementById('aar-op').value,
    location: document.getElementById('aar-location').value,
    scene: document.getElementById('aar-scene').value,
    cinematic_prompt: debriefPrompt !== 'Generate a cinematic Banana Pro prompt from your scene description above.' ? debriefPrompt : '',
    photo: aarPhotoDataUrl || null
  };

  if (!entry.operation) { status.textContent = 'Enter operation name.'; return; }

  status.textContent = 'Filing report…';

  const existing = (afData?.aar_log && afData.aar_log !== '') ? (() => { try { return JSON.parse(afData.aar_log); } catch(e) { return []; } })() : [];
  existing.push(entry);
  const payload = {
    action: 'update_aar',
    agent_code: afCode,
    token: agentToken(afCode),
    aar_log: JSON.stringify(existing)
  };

  afFetch(payload).then(() => {
    status.textContent = 'Report filed.';
    if (!afData) afData = {};
    afData.aar_log = JSON.stringify(existing);
    renderAarEntries(afData);
    toggleAarForm();
    aarPhotoDataUrl = null;
  }).catch(() => {
    status.textContent = 'Error — try again.';
  });
}



/* ── Random Agent Generator: tables and generateAgent() are in
   assets/appearance-gen.js (shared with the character sheet's Appearance). ── */
function fillFormFromAgent(agent) {
  const form = document.getElementById('dg-form');
  Object.keys(agent).forEach(key => {
    const el = form.elements[key];
    // Skip fields populateCoverForm() locked as already-known Agent
    // data (see its own comment) -- Random Generate fills in the rest
    // of the brief, it doesn't reroll what's already decided.
    if (!el || el.dataset.locked === '1') return;
    el.value = agent[key];
  });
}

function randomizeAgent(archetypeId) {
  const agent = generateAgent(archetypeId || null);
  fillFormFromAgent(agent);
  // Scroll to form
  document.getElementById('dg-form').scrollIntoView({behavior:'smooth'});
  // Show reroll button and hint
  const bar = document.getElementById('rand-result-bar');
  if (bar) bar.style.display = 'flex';
  const reroll = document.getElementById('rand-reroll-btn');
  if (reroll) reroll.style.display = 'inline-block';
}

function rerollAgent() {
  const sel = document.getElementById('rand-profession');
  randomizeAgent(sel ? sel.value || null : null);
}

/* ══════════════════════════════════════════════
   AGENT ROSTER — persistent multi-agent store (this hub's addition).
   Every agent that gets persist​Agent()'d in this browser -- Cover form
   submit, Agent File load by code, any era-prompt/photo save -- also
   joins this roster automatically (see persistAgent() above), so
   whoever's using this browser (a Handler checking multiple players'
   agents, a player who's made more than one over time) can see and
   switch between all of them, not just the single most-recently-active
   one dg_last_agent tracks.
   ══════════════════════════════════════════════ */

const ROSTER_KEY = 'dg_agent_roster';

function rosterLoad() {
  try { return JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}'); } catch(e) { return {}; }
}

function rosterSave(roster) {
  try { localStorage.setItem(ROSTER_KEY, JSON.stringify(roster)); } catch(e) {}
}

// Backend hardening: every player-owned write now needs a per-Agent
// secret token (see requireAgentToken_() in Code.gs). Rather than
// having the server mint one and hand it back -- unreliable, since
// most writes here are fire-and-forget `mode:'no-cors'` POSTs whose
// response can never be read -- each browser mints its own the first
// time it needs one for a given Agent Code and just starts sending it.
// The server's first sight of a token for a code with none on file
// yet is treated as that code's claim, so this "just works" with no
// round trip: an existing player's browser already holds the same
// token it's been sending all along, which is what lets their saved
// data keep working with zero action from them, even much later.
function agentToken(code) {
  if (!code) return '';
  var roster = rosterLoad();
  var existing = roster[code] && roster[code].token;
  if (existing) return existing;
  var token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'tok_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  if (!roster[code]) roster[code] = { code: code };
  roster[code].token = token;
  rosterSave(roster);
  return token;
}

function rosterAddAgent(code, data) {
  if (!code || !data) return;
  var roster = rosterLoad();
  var existingToken = (roster[code] && roster[code].token) || '';
  // Store only slim fields — no base64 images which can exceed localStorage quota
  roster[code] = {
    code: code,
    char_name: data.char_name || '',
    codename: data.codename || '',
    sex: data.sex || '',
    age_range: data.age_range || '',
    nationality: data.nationality || '',
    active_eras: data.active_eras || '',
    face_plate_url: (window.dgStore && window.dgStore.mainPhoto) ? window.dgStore.mainPhoto(data) : (data.face_plate_url || ''),
    campaign_era: data.campaign_era || '',
    // Not shown anywhere in this roster's own UI -- read only by
    // agent-hub.html's Cover Identity search, to tell an Agent nobody's
    // claimed yet (safe to always keep locally) apart from one already
    // tied to a *different* real name (safe to drop on a search for a
    // name that isn't this one).
    player_name: (data.player_name || '').trim(),
    // Preserve whatever token this Agent Code already had -- this
    // function overwrites the whole roster entry on every save, and a
    // token minted by agentToken() on an earlier write must survive
    // that overwrite rather than being silently dropped.
    token: data.token || existingToken,
    saved_at: Date.now()
  };
  try {
    rosterSave(roster);
  } catch(e) {
    // If quota exceeded, try without face_plate_url
    roster[code].face_plate_url = '';
    try { rosterSave(roster); } catch(e2) {}
  }
  afRosterChanged_(code);
}












/* ══════════════════════════════════════════════
   AGENT HUB: one Agent File, mounted in whichever Agent's tab is open
   ══════════════════════════════════════════════ */
var afMountedCode = null;  // the Agent whose tab this file is in
var afAppearOpen = false;  // Appearance unfolded by hand (Edit)
var afShownFor = null;     // the Agent the file has finished loading
var afPendingFocus = null; // a focus() asked for before that

// Each Agent tab switch reloads the file; nothing stale from the last one.
function afReset_() {
  afData = null; afCode = null;
  afShownFor = null;
  afAppearOpen = false;
  photoDataUrl = null; refImageFile = null;
  const form = document.getElementById('dg-form');
  form.reset();
  Array.prototype.forEach.call(form.elements, function (el) {
    el.classList.remove('cover-field-locked'); delete el.dataset.locked;
  });
  const btn = document.getElementById('submit-btn');
  btn.disabled = false; btn.textContent = 'Submit Brief';
  document.getElementById('form-status').textContent = '';
  document.getElementById('upload-prev').style.display = 'none';
  document.getElementById('code-load-status').textContent = '';
  document.getElementById('rand-result-bar').style.display = 'none';
  document.getElementById('rand-reroll-btn').style.display = 'none';
  document.getElementById('af-content').style.display = 'none';
  document.getElementById('era-stack').innerHTML = '';
  document.getElementById('af-appear-state').textContent = 'Loading…';
  document.getElementById('af-appear-toggle').hidden = true;
}

function afRequiredFields_() {
  return Array.prototype.slice.call(document.getElementById('dg-form').querySelectorAll('[required]'));
}
function afMissing_(data) {
  return afRequiredFields_().filter(function (el) {
    const v = data && data[el.name];
    return v === undefined || v === null || !String(v).trim();
  });
}

// What the file shows for the current Agent: Appearance open until the
// brief is complete (then folded, with Edit), era photos only once it
// is -- they're made from it.
function afRender_() {
  const complete = !!afData && isProfilingComplete(afData);
  const missing = afMissing_(afData || {}).length;
  const total = afRequiredFields_().length;
  const open = !complete || afAppearOpen;
  document.getElementById('af-appear').classList.toggle('af-open', open);
  document.getElementById('af-appear').classList.toggle('af-done', complete);
  document.getElementById('af-appear-state').textContent = complete ? 'On file' : (missing + ' of ' + total + ' still to fill in');
  const toggle = document.getElementById('af-appear-toggle');
  toggle.hidden = !complete;
  toggle.textContent = afAppearOpen ? 'Close' : 'Edit';
  const note = document.getElementById('code-load-status');
  if (!complete) {
    note.textContent = afData && afData.char_name
      ? 'Your character sheet carried over. Add how this Agent looks to finish the Agent File -- your Handler makes the photos from it.'
      : 'Describe how this Agent looks -- your Handler makes the photos from it.';
  } else {
    note.textContent = '';
  }
  document.getElementById('af-photos-locked').hidden = complete;
  if (complete) renderAgentFile(afData);
  else document.getElementById('af-content').style.display = 'none';
  try {
    window.dispatchEvent(new CustomEvent('dg-agent-file-state', { detail: { code: afMountedCode, complete: complete, missing: missing, total: total } }));
  } catch (e) { /* old engine */ }
  afShownFor = afMountedCode;
  if (afPendingFocus) {
    const part = afPendingFocus;
    afPendingFocus = null;
    setTimeout(function () { window.dgAgentFile.focus(part); }, 50);
  }
}

function afLoad_(code, retrying) {
  window.dgStore.getBrief(code).then(function (data) {
    if (afMountedCode !== code) return; // moved on to another tab meanwhile
    if (data) {
      afData = data; afCode = code;
      persistAgent(code, data);
      healMainPhoto();
      populateCoverForm(data);
      afRender_();
    } else if (!retrying) {
      autoCreateBriefFromCharacterThenRetry_(code,
        function () { afLoad_(code, true); },
        function () { afNoBrief_(code); });
    } else {
      afNoBrief_(code);
    }
  }, function () {
    if (afMountedCode !== code) return;
    document.getElementById('af-appear-state').textContent = 'Could not load -- check your connection.';
  });
}
// No Agent File yet and no character sheet to start one from: a blank
// Appearance brief for this Agent, with what the roster already knows.
function afNoBrief_(code) {
  afCode = code; afData = null;
  const r = rosterLoad()[code] || {};
  const seed = {};
  ['char_name', 'codename', 'sex', 'age_range', 'nationality', 'player_name'].forEach(function (k) { if (r[k]) seed[k] = r[k]; });
  populateCoverForm(seed);
  document.getElementById('submit-btn').textContent = 'Submit Brief';
  afRender_();
}


// After Submit: fold Appearance, show the photos, tell the hub.
function openInAgentFile() {
  afAppearOpen = false;
  afRender_();
  afRosterChanged_(afCode);
  const target = document.getElementById(isProfilingComplete(afData) ? 'af-photos' : 'af-appear');
  if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function afRosterChanged_(code) {
  try { window.dispatchEvent(new CustomEvent('dg-agent-file-saved', { detail: { code: code } })); } catch (e) { /* old engine */ }
}

document.getElementById('af-appear-toggle').addEventListener('click', function () {
  afAppearOpen = !afAppearOpen;
  afRender_();
});

// Held directly: while the hub rebuilds, the file can be out of the page.
var afRootEl = document.getElementById('af-root');
var afHolderEl = document.getElementById('af-holder');
window.dgAgentFile = {
  // Put the file in this Agent's tab (slot) and load them, unless it's
  // already showing them.
  mount: function (slot, code) {
    if (afRootEl.parentNode !== slot) slot.appendChild(afRootEl);
    if (afMountedCode === code) return;
    afMountedCode = code;
    afReset_();
    afLoad_(code);
  },
  // Out of the way while the hub rebuilds its tabs (keeps state).
  park: function () {
    afHolderEl.appendChild(afRootEl);
  },
  code: function () { return afMountedCode; },
  data: function () { return afData; },
  complete: function () { return !!afData && isProfilingComplete(afData); },
  // Scroll to a part of the file: 'appearance' (unfolds it) or 'photos'
  // -- once the Agent has loaded, if asked before that.
  focus: function (part) {
    if (afShownFor !== afMountedCode) { afPendingFocus = part; return; }
    if (part === 'appearance') { afAppearOpen = true; afRender_(); }
    const el = document.getElementById(part === 'photos' && this.complete() ? 'af-photos' : 'af-appear');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};
