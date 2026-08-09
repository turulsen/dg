/* ══════════════════════════════════════════════
   IMPORT FROM GOOGLE SHEET / XLSX (this hub's addition, mirrors
   pdf-export.js's importFromPDF() for the .xlsx export sheets-export.js
   already produces).

   Reads cell values back out of the same addresses exportToSheets()
   writes to. Also resolves xl/sharedStrings.xml, not just the inlineStr
   cells the export itself writes -- if a player uploads the exported
   file to Google Sheets, edits it there, and downloads it again, Google
   Sheets commonly rewrites those cells as shared-string references
   instead of inline strings, and this is expected to be the normal
   round-trip for "pigeon google sheet" imports, not an edge case.

   What is recovered: name, profession, employer, nationality, sex, age,
   education, physical description, motivations, all six stats +
   distinguishing features, current HP/WP, all skills (including the five
   specialty skills' base value + label, and up to 6 foreign-language/
   custom overflow rows), up to 6 bonds (name + score), gear/armor text
   (imported as custom loadout items), wounds notes, and personal notes.
   What is NOT recovered: SAN incident checkboxes, per-skill failure
   checkboxes, the structured weapons table (its own gear text still
   comes through), and bonus-skill/theme state -- same class of
   limitation the PDF importer already documents.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  const JSZIP_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  // Same cell maps as sheets-export.js -- duplicated rather than shared,
  // matching this codebase's existing pattern of each export/import module
  // being self-contained (see pdf-export.js's own independent field map).
  const SKILL_CELL = {
    accounting: "L28", alertness: "L29", anthropology: "L30", archeology: "L31",
    art: "L32", artillery: "L34", athletics: "L35", bureaucracy: "L36",
    computer_science: "L37", craft: "L38", criminology: "L40", demolitions: "L41",
    disguise: "L42", dodge: "L43", drive: "L44", firearms: "L45",
    first_aid: "X28", forensics: "X29", heavy_machiner: "X30", heavy_weapons: "X31",
    history: "X32", humint: "X33", law: "X34", medicine: "X35",
    melee_weapons: "X36", military_science: "X37", navigate: "X39", occult: "X40",
    persuade: "X41", pharmacy: "X42", pilot: "X43", psychotherapy: "X45",
    ride: "AJ28", science: "AJ29", search: "AJ31", sigint: "AJ32",
    stealth: "AJ33", surgery: "AJ34", survival: "AJ35", swim: "AJ36",
    unarmed_combat: "AJ37", unnatural: "AJ38",
  };
  const SPECIALTY_LABEL_CELL = {
    art: "D33", craft: "D39", military_science: "P38", pilot: "P44", science: "AB30",
  };
  const FOREIGN_ROWS = [40, 41, 42, 43, 44, 45];

  function loadJSZip() {
    return new Promise((resolve, reject) => {
      if (window.JSZip) { resolve(); return; }
      const s = document.createElement("script");
      s.src = JSZIP_CDN;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load JSZip from CDN."));
      document.head.appendChild(s);
    });
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const strings = [];
    // Each <si> holds either a plain <t>text</t> or several <r><t>text</t></r>
    // runs (rich text) -- concatenate all <t> contents within each <si>.
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(xml)) !== null) {
      const body = m[1];
      let text = "";
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let tm;
      while ((tm = tRe.exec(body)) !== null) text += tm[1];
      strings.push(unescapeXml(text));
    }
    return strings;
  }

  function unescapeXml(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }

  /** Read a cell's value back out of worksheet XML, resolving shared strings. */
  function readCell(xml, sharedStrings, addr) {
    const openTag = `<c r="${addr}"`;
    const openIdx = xml.indexOf(openTag);
    if (openIdx < 0) return "";
    const gtIdx = xml.indexOf(">", openIdx);
    if (gtIdx < 0) return "";
    const tagContent = xml.slice(openIdx, gtIdx + 1);

    if (tagContent.endsWith("/>")) return ""; // self-closing = blank cell

    const closeIdx = xml.indexOf("</c>", gtIdx);
    if (closeIdx < 0) return "";
    const inner = xml.slice(gtIdx + 1, closeIdx);

    // inlineStr: <is><t>text</t></is>
    const isMatch = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
    if (isMatch) return unescapeXml(isMatch[1]).trim();

    const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
    if (!vMatch) return "";
    const raw = vMatch[1];

    if (/\bt="s"/.test(tagContent)) {
      const idx = parseInt(raw, 10);
      return Number.isFinite(idx) ? (sharedStrings[idx] || "").trim() : "";
    }
    if (/\bt="b"/.test(tagContent)) return raw === "1";
    // Plain numeric (or an unlabeled string Google Sheets left as str type)
    return raw.trim();
  }

  function readNum(xml, sharedStrings, addr) {
    const v = readCell(xml, sharedStrings, addr);
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function readStr(xml, sharedStrings, addr) {
    const v = readCell(xml, sharedStrings, addr);
    return typeof v === "string" ? v : "";
  }

  async function importFromSheets() {
    let input = document.getElementById("dg-sheets-import-input");
    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      input.id = "dg-sheets-import-input";
      input.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      input.style.cssText = "display:none;position:fixed;top:0;left:0";
      document.body.appendChild(input);
    }
    input.value = "";
    input.onchange = async function (e) {
      const file = e.target.files?.[0];
      if (!file) return;
      if (window.showToast) showToast("Reading spreadsheet…");
      try {
        await loadJSZip();
        const bytes = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(bytes);

        const s1File = zip.file("xl/worksheets/sheet1.xml");
        if (!s1File) throw new Error("Not a Delta Green character sheet (missing sheet1.xml).");
        const s1 = await s1File.async("string");
        const s2File = zip.file("xl/worksheets/sheet2.xml");
        const s2 = s2File ? await s2File.async("string") : "";
        const sharedStringsFile = zip.file("xl/sharedStrings.xml");
        const sharedStrings = sharedStringsFile
          ? parseSharedStrings(await sharedStringsFile.async("string"))
          : [];

        const bio = {
          name: readStr(s1, sharedStrings, "C6"),
          profession: readStr(s1, sharedStrings, "U6"),
          employer: readStr(s1, sharedStrings, "C8"),
          nationality: readStr(s1, sharedStrings, "U8"),
          sex: readStr(s1, sharedStrings, "C10"),
          age: readStr(s1, sharedStrings, "K10"),
          education: readStr(s1, sharedStrings, "Q10"),
          physicalDesc: readStr(s1, sharedStrings, "C25"),
          motivations: readStr(s1, sharedStrings, "V20"),
        };

        const csStats = {};
        ["STR", "CON", "DEX", "INT", "POW", "CHA"].forEach((st, i) => {
          csStats[st] = readNum(s1, sharedStrings, "H" + (13 + i)) || 3;
        });

        const derived = {
          hp: readNum(s1, sharedStrings, "P20"),
          wp: readNum(s1, sharedStrings, "P21"),
        };

        const skills = {};
        const skillSpecs = {};
        Object.entries(SKILL_CELL).forEach(([key, addr]) => {
          const val = readNum(s1, sharedStrings, addr);
          if (val > 0) skills[key] = val;
        });
        Object.entries(SPECIALTY_LABEL_CELL).forEach(([key, addr]) => {
          const label = readStr(s1, sharedStrings, addr);
          if (label) skillSpecs[key] = label;
        });

        const customSkills = [];
        FOREIGN_ROWS.forEach(row => {
          const name = readStr(s1, sharedStrings, "AB" + row);
          const value = readNum(s1, sharedStrings, "AJ" + row);
          if (name && value > 0) customSkills.push({ name, value });
        });

        const bonds = [];
        for (let i = 0; i < 6; i++) {
          const row = 13 + i;
          const label = readStr(s1, sharedStrings, "V" + row);
          const score = readNum(s1, sharedStrings, "AJ" + row);
          if (label) {
            const m = label.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
            bonds.push({ name: m ? m[1].trim() : label, relationship: m ? m[2].trim() : "", score });
          }
        }

        const gearText = s2 ? readStr(s2, sharedStrings, "C12") : "";
        const equipment = gearText
          ? gearText.split("\n").map(l => l.trim()).filter(Boolean).map(n => ({ isCustom: true, name: n }))
          : [];
        const woundsText = s2 ? readStr(s2, sharedStrings, "C3") : "";
        const personalDetails = s2 ? readStr(s2, sharedStrings, "C30") : "";
        if (personalDetails) bio.personalDetails = personalDetails;

        const sanity = { violence: [false, false, false], helplessness: [false, false, false] };
        const lpNotes = { wounds: woundsText, gear: "", remarks: "" };

        // Same state shape importFromPDF() (pdf-export.js) uses -- stats
        // aliases csStats so both the display spans and the form inputs
        // applyState() writes to stay in sync, and every field applyState()
        // reads is present (even if empty) so nothing it does is skipped.
        const state = {
          v: 1, bio, stats: csStats, csStats, derived, skills,
          skillSpecs, customSkills, bonds, sanity, equipment,
          lpNotes, lpWeapons: [], lpFeat: {}, optionalSkillChecked: [],
          bonusPrepared: false, bonusSkills: [], bonusApplied: false,
          appliedBonuses: {}, specialtyInstances: [], lpCheckedSkills: [],
          lpCustomSkills: [], professionSkillsApplied: false,
        };

        if (window.dgSaveLoad && typeof window.dgSaveLoad.applyState === "function") {
          window.dgSaveLoad.applyState(state);
          setTimeout(() => {
            window.dgSaveLoad.save?.();
            if (typeof syncLpFromForm === "function") syncLpFromForm();
          }, 300);
          if (window.showToast) showToast("Character imported from spreadsheet! Review stats and skills — specialties and weapon rows must be re-entered manually.");
        } else {
          alert("Import function not available.");
        }
      } catch (err) {
        console.error("[DG Sheets Import]", err);
        if (window.showToast) showToast("Could not read that spreadsheet — see console for details.");
        else alert("Could not read that spreadsheet: " + err.message);
      }
    };
    input.click();
  }

  window.importFromSheets = importFromSheets;
})();
