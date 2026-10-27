/**
 * DD Form 315 PDF: export and import (window.dgSheetPdf)
 *
 * download(state): fills the fillable DD Form 315 (next to this script)
 * from a saved character and downloads it -- the notebook's Settings ->
 * Export -> PDF. read(file): reads one back into a saved-character state
 * -- New Recruit's import (assets/agent-import.js). pdf-lib is loaded
 * from a CDN on first use. Field names come straight from the PDF's
 * AcroForm dictionary.
 *
 * From DELTA-GREEN-STATS (c) 2024 Brook Morton, PolyForm Noncommercial
 * 1.0.0: see assets/data/LICENSE-UPSTREAM.md.
 */
(function () {
    "use strict";

    // Next to this script, whichever page loaded it.
    const TEMPLATE_URL = (document.currentScript && document.currentScript.src)
        ? new URL("Delta-Green-RPG-Character-Sheet.pdf", document.currentScript.src).href
        : "assets/sheet-io/Delta-Green-RPG-Character-Sheet.pdf";
    const PDF_LIB_CDN = "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js";

    const SKILL_FIELD = {
        accounting: "Accounting 10",
        alertness: "Alertness 20",
        anthropology: "Anthropology 0",
        archeology: "Archeology 0",
        art: "Art 0",
        artillery: "Artillery 0",
        athletics: "Athletics 30",
        bureaucracy: "Bureaucracy 10",
        computer_science: "Computer Science 0",
        craft: "Craft 0",
        criminology: "Criminology 10",
        demolitions: "Demolitions 0",
        disguise: "Disguise 10",
        dodge: "Dodge 30",
        drive: "Drive 20",
        firearms: "Firearms 20",
        first_aid: "First Aid 10",
        forensics: "Forensics 0",
        heavy_machiner: "Heavy Machinery 10",
        heavy_weapons: "Heavy Weapons 0",
        history: "History 10",
        humint: "HUMINT 10",
        law: "Law 0",
        medicine: "Medicine 0",
        melee_weapons: "Melee Weapons 30",
        military_science: "Military Science 0",
        navigate: "Navigate 10",
        occult: "Occult 10",
        persuade: "Persuade 20",
        pharmacy: "Pharmacy 0",
        pilot: "Pilot 0",
        psychotherapy: "Psychotherapy 10",
        ride: "Ride 10",
        science: "Science 0",
        search: "Search 20",
        sigint: "SIGINT 0",
        stealth: "Stealth 10",
        surgery: "Surgery 0",
        survival: "Survival 10",
        swim: "Swim 20",
        unarmed_combat: "Unarmed Combat 40",
        unnatural: "Unnatural 0",
    };

    const SPECIALTY_LABEL_FIELD = {
        art: "Art",
        craft: "Craft",
        pilot: "Pilot",
        science: "Science",
        military_science: "Military Science",
    };

    const WEAPON_LETTERS = ["a", "b", "c", "d", "e", "f", "g"];

    function loadPdfLib() {
        return new Promise((resolve, reject) => {
            if (window.PDFLib) { resolve(); return; }
            const s = document.createElement("script");
            s.src = PDF_LIB_CDN;
            s.onload = resolve;
            s.onerror = () => reject(new Error("Could not load pdf-lib from CDN."));
            document.head.appendChild(s);
        });
    }

    function setField(form, fieldName, value) {
        if (value === null || value === undefined || value === "") return;
        const str = String(value).trim();
        if (!str) return;
        try { form.getTextField(fieldName).setText(str); } catch (_) { }
    }

    function checkBox(form, fieldName, doCheck) {
        if (!doCheck) return;
        try { form.getCheckBox(fieldName).check(); } catch (_) { }
    }

    // The filled form's bytes.
    async function build(state) {
        await loadPdfLib();
        const { PDFDocument } = window.PDFLib;

        const bytes = await fetch(TEMPLATE_URL).then(r => {
            if (!r.ok) throw new Error("Template not found (HTTP " + r.status + ").");
            return r.arrayBuffer();
        });

        const pdfDoc = await PDFDocument.load(bytes);
        const form = pdfDoc.getForm();

        const bio = state.bio || {};
        const stats = state.csStats || state.stats || {};
        const derived = state.derived || {};
        const skills = state.skills || {};
        const skillSpec = state.skillSpecs || {};
        const bonds = state.bonds || [];
        const custom = state.customSkills || [];
        const specialtyInstances = state.specialtyInstances || [];
        const sanity = state.sanity || {};
        const lpNotes = state.lpNotes || {};
        const lpFeat = (window.dgRules && window.dgRules.features) ? window.dgRules.features(state) : (state.lpFeat || {});
        const lpWeapons = state.lpWeapons || [];
        const equipment = state.equipment || [];

        // Personal data
        setField(form, "1 LAST NAME FIRST NAME MIDDLE INITIAL", bio.name);
        setField(form, "2 PROFESSION RANK IF APPLICABLE", bio.profession);
        setField(form, "3 EMPLOYER", bio.employer);
        setField(form, "4 NATIONALITY", bio.nationality);
        setField(form, "SEX", bio.sex);
        setField(form, "6 AGE AND DOB", bio.age);
        setField(form, "7 EDUCATION AND OCCUPATION", bio.education);
        setField(form, "10 PHYSICAL DESCRIPTION", bio.physicalDesc);
        // Box 12 holds both; each disorder on its own "Disorder: …" line.
        setField(form, "12 MOTIVATIONS AND MENTAL DISORDERSPSYCHOLOGICAL DATA", (window.dgDisorders ? window.dgDisorders.combine(bio.motivations, bio.disorders) : bio.motivations));

        // Statistics + distinguishing features
        ["STR", "CON", "DEX", "INT", "POW", "CHA"].forEach(st => {
            const val = stats[st] || 3;
            setField(form, st, String(val));
            setField(form, st + "x5", String(val * 5));
            setField(form, st + " DISTINGUISHING FEATURES", lpFeat[st] || "");
        });

        // Derived attributes: the saved values are the current ones;
        // the maximums come from the rules (assets/agent-rules.js).
        const maxes = window.dgRules && window.dgRules.maxes ? window.dgRules.maxes(state) : {};
        setField(form, "MAXIMUMHit Points HP", maxes.hp != null ? maxes.hp : derived.hp);
        setField(form, "CURRENTHit Points HP", derived.hp);
        setField(form, "MAXIMUMWillpower Points WP", maxes.wp != null ? maxes.wp : derived.wp);
        setField(form, "CURRENTWillpower Points WP", derived.wp);
        setField(form, "MAXIMUMSanity Points SAN", maxes.san != null ? maxes.san : derived.san);
        setField(form, "CURRENTSanity Points SAN", derived.san);
        setField(form, "CURRENTBreaking Point BP", derived.bp);

        // Specialty skill keys that have both a score field and a label field in the PDF
        const SPECIALTY_KEYS = Object.keys(SPECIALTY_LABEL_FIELD); // art, craft, science, pilot, military_science
        const SPECIALTY_BASE_NAME = { art: "Art", craft: "Craft", science: "Science", pilot: "Pilot", military_science: "Military Science" };

        // Overflow specialty instances that don't fit the main row → Foreign Languages slots
        const overflowSpecialties = [];

        // Foreign Language has no PDF main-row field — all instances go straight to overflow
        specialtyInstances
            .filter(i => i.key === "foreign_language" && i.value > 0)
            .sort((a, b) => b.value - a.value)
            .forEach(inst => {
                overflowSpecialties.push({
                    name: inst.specialty || "Foreign Language",
                    value: inst.value,
                });
            });

        // Specialty skills: highest-value instance fills the main row; extras go to overflow
        SPECIALTY_KEYS.forEach(key => {
            const instances = specialtyInstances
                .filter(i => i.key === key && i.value > 0)
                .sort((a, b) => b.value - a.value);
            if (instances.length === 0) {
                // Fall back to skills[key] + skillSpec[key] (older saves)
                const val = skills[key];
                if (val && val > 0) {
                    setField(form, SKILL_FIELD[key], String(val));
                    const spec = skillSpec[key];
                    if (spec) setField(form, SPECIALTY_LABEL_FIELD[key], spec);
                }
                return;
            }
            // Best instance → main row
            const best = instances[0];
            setField(form, SKILL_FIELD[key], String(best.value));
            setField(form, SPECIALTY_LABEL_FIELD[key], best.specialty || SPECIALTY_BASE_NAME[key]);
            // Remaining instances → overflow queue
            instances.slice(1).forEach(inst => {
                const label = inst.specialty
                    ? SPECIALTY_BASE_NAME[key] + " (" + inst.specialty + ")"
                    : SPECIALTY_BASE_NAME[key];
                overflowSpecialties.push({ name: label, value: inst.value });
            });
        });

        // Non-specialty skills
        Object.entries(SKILL_FIELD).forEach(([key, fieldName]) => {
            if (SPECIALTY_KEYS.includes(key)) return; // handled above
            const val = skills[key];
            if (val && val > 0) setField(form, fieldName, String(val));
        });

        // Bonds (up to 6)
        bonds.slice(0, 6).forEach((b, i) => {
            const n = i + 1;
            const name = b.name || b.label || "";
            const rel = b.relationship || "";
            const bondLabel = name && rel ? name + " (" + rel + ")" : name || rel;
            setField(form, "BOND " + n, bondLabel);
            setField(form, "BOND " + n + " SCORE", b.score != null ? String(b.score) : "");
        });

        // Foreign Languages / Other Skills — overflow specialties first, then custom skills (up to 6 total)
        // De-duplicate: skip customSkills whose name already appears in overflowSpecialties
        const overflowNames = new Set(overflowSpecialties.map(s => s.name.toLowerCase()));
        const foreignSlots = [
            ...overflowSpecialties,
            ...custom.filter(s => s.value > 0 && !overflowNames.has(s.name.toLowerCase())),
        ].slice(0, 6);
        foreignSlots.forEach((sk, i) => {
            const n = i + 1;
            setField(form, "Foreign Languages and Other Skills " + n, sk.name || "");
            setField(form, "Foreign Languages and Other Skills " + n + " Score", String(sk.value));
        });

        // SAN incident checkboxes — Box1-3 Violence, Box4-6 Helplessness
        (sanity.violence || []).forEach((v, i) => checkBox(form, "Check Box" + (i + 1), v));
        (sanity.helplessness || []).forEach((v, i) => checkBox(form, "Check Box" + (i + 4), v));

        // Page 2
        setField(form, "14 WOUNDS AND AILMENTS_2", lpNotes.wounds);

        // Gear: the written-in text, then each item (weapons have their own table below)
        const gearLines = [];
        if (lpNotes.gear) gearLines.push(lpNotes.gear);
        equipment.forEach(n => { const nm = typeof n === "string" ? n : (n && n.name) || ""; if (nm) gearLines.push(nm); });
        setField(form, "15 ARMOR AND GEAR", gearLines.join("\n").trim());

        setField(form, "17 PERSONAL DETAILS AND NOTES", bio.personalDetails || lpNotes.remarks || '');

        // Weapons — exact field names from PDF AcroForm dictionary
        lpWeapons.slice(0, 7).forEach((w, i) => {
            const lt = WEAPON_LETTERS[i];
            setField(form, "WEAPON" + lt, w.name || "");
            setField(form, "SKILL " + lt, w.skillPct || "");
            setField(form, "BASE RANGE" + lt, w.range || "");
            setField(form, "DAMAGE" + lt, w.damage || "");
            setField(form, "KILL DAMAGE" + lt, w.lethality || "");
            setField(form, "KILL RADIUS" + lt, w.killRadius || "");
            setField(form, "AMMO " + lt, w.ammo || "");
        });

        // Special training — overflow custom skills beyond slot 6
        custom.filter(s => s.value > 0).slice(6).slice(0, 6).forEach((sk, i) => {
            const lt = WEAPON_LETTERS[i];
            setField(form, "SPECIAL TRAINING" + lt, sk.name || "");
            setField(form, "SKILL OR STAT" + lt, String(sk.value));
        });

        return pdfDoc.save();
    }

    // Fill the form and download it as "<name> - DD Form 315.pdf".
    async function download(state) {
        const pdfBytes = await build(state);
        const bio = state.bio || {};
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const safeName = (bio.name || "Agent").replace(/[^a-z0-9 \-_]/gi, "").trim() || "Agent";
        const a = Object.assign(document.createElement("a"), {
            href: url,
            download: safeName + " - DD Form 315.pdf",
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 8000);
    }

    // ─── Import from DD Form 315 PDF ────────────────────────────────────────

    /**
     * Read a fillable DD Form 315 back into a saved-character state.
     * Recovered: stats, skills, biography, HP/WP/SAN/BP, the SAN incident
     * boxes, bonds (name + score), wounds and gear text. Not recovered:
     * specialty instances, full bond detail and weapon rows.
     */
    async function read(file) {
        await loadPdfLib();
        const { PDFDocument } = window.PDFLib;
        const bytes = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(bytes);
        const form = pdfDoc.getForm();
        // pdf-lib silently fabricates an empty AcroForm instead of throwing
        // when a PDF has none at all (e.g. a flattened/rasterized export like
        // Kappa Black's PDF download) -- every field read below would then
        // quietly fail and "succeed" with a blank character. Fail loudly here
        // instead, before any of that happens.
        if (form.getFields().length === 0) {
            throw new Error("This PDF has no fillable form fields \u2014 it looks like a flattened/printed export (e.g. Kappa Black's PDF download), not the fillable DD Form 315. Export from Kappa Black as .toml or .json instead.");
        }

        function readField(name) {
            try { return form.getTextField(name).getText() || ''; } catch (_) { /* fall through */ }
            // Some sheet variants (e.g. an Employer picker) use a dropdown
            // instead of a plain text field for the same field name --
            // getTextField() throws on those, so try a dropdown read too
            // before giving up.
            try { return form.getDropdown(name).getSelected()[0] || ''; } catch (_) { return ''; }
        }
        function readCheck(name) {
            try { return form.getCheckBox(name).isChecked(); } catch (_) { return false; }
        }

        const bio = {
            name: readField('1 LAST NAME FIRST NAME MIDDLE INITIAL'),
            profession: readField('2 PROFESSION RANK IF APPLICABLE'),
            employer: readField('3 EMPLOYER'),
            nationality: readField('4 NATIONALITY'),
            sex: readField('SEX'),
            age: readField('6 AGE AND DOB'),
            education: readField('7 EDUCATION AND OCCUPATION'),
            physicalDesc: readField('10 PHYSICAL DESCRIPTION'),
            motivations: readField('12 MOTIVATIONS AND MENTAL DISORDERSPSYCHOLOGICAL DATA'),
            personalDetails: readField('17 PERSONAL DETAILS AND NOTES'),
        };

        const csStats = {};
        ['STR', 'CON', 'DEX', 'INT', 'POW', 'CHA'].forEach(st => {
            csStats[st] = parseInt(readField(st)) || 3;
        });

        const skills = {};
        Object.entries(SKILL_FIELD).forEach(([key, fieldName]) => {
            const val = parseInt(readField(fieldName));
            if (val > 0) skills[key] = val;
        });

        const derived = {
            hp: parseInt(readField('CURRENTHit Points HP')) || parseInt(readField('MAXIMUMHit Points HP')) || 0,
            wp: parseInt(readField('CURRENTWillpower Points WP')) || parseInt(readField('MAXIMUMWillpower Points WP')) || 0,
            san: parseInt(readField('CURRENTSanity Points SAN')) || parseInt(readField('MAXIMUMSanity Points SAN')) || 0,
            bp: parseInt(readField('CURRENTBreaking Point BP')) || 0,
        };

        const sanity = {
            violence: [1, 2, 3].map(n => readCheck('Check Box' + n)),
            helplessness: [1, 2, 3].map(n => readCheck('Check Box' + (n + 3))),
        };

        // Bonds — up to 6
        const bonds = [];
        for (let i = 1; i <= 6; i++) {
            const label = readField('BOND ' + i);
            const score = parseInt(readField('BOND ' + i + ' SCORE')) || 0;
            if (label) {
                // Best-effort: split "Name (relationship)" back apart
                const m = label.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
                bonds.push({ name: m ? m[1].trim() : label, relationship: m ? m[2].trim() : '', score });
            }
        }

        // Gear — split the armor/gear text field into individual custom items
        const gearText = readField('15 ARMOR AND GEAR');
        const equipment = gearText
            ? gearText.split('\n').map(l => l.trim()).filter(Boolean)
                .map(n => ({ isCustom: true, name: n }))
            : [];

        const lpNotes = {
            wounds: readField('14 WOUNDS AND AILMENTS_2'),
            gear: '',
            remarks: '',
        };

        return {
            v: 1, bio, stats: csStats, csStats, derived, skills,
            skillSpecs: {}, customSkills: [], bonds, sanity, equipment,
            lpNotes, lpWeapons: [], lpFeat: {}, specialtyInstances: [], lpCheckedSkills: [],
        };
    }

    window.dgSheetPdf = { build: build, download: download, read: read };
})();
