// The Agent File's AI prompt builder, moved here from backend/Code.gs's
// generateAppearancePrompt() (the Apps Script backend is retired). The
// prompt text is the same, character for character -- only the
// surrounding transport changed.
'use strict';

function buildAppearancePrompt(data) {
    const char = data.character || {};
    const injuries = data.injuries || [];
    const era = data.era || '';
    const eraLabels = {'90s':'1990s Cold War Aftermath','00s':'2000s War on Terror','10s':'2010s Digital Age','20s':'2020s Present Day'};
    const eraLabel = eraLabels[era] || '';
    const eraOutfitContext = {
      '90s': 'Era is the 1990s. Clothing should reflect early-to-mid 1990s fashion — heavier fabrics, baggier cuts, muted earth tones and neutrals, practical field-ready styling of the Cold War aftermath period.',
      '00s': 'Era is the 2000s. Clothing should reflect early-to-mid 2000s fashion — slightly slimmer cuts than the 90s, tactical-influenced civilian wear, post-9/11 federal agency aesthetic.',
      '10s': 'Era is the 2010s. Clothing should reflect 2010s fashion — fitted contemporary cuts, smart-casual federal professional register, modern tactical civilian crossover.',
      '20s': 'Era is the 2020s. Clothing should reflect current contemporary fashion — clean modern cuts, technical fabrics, present-day federal professional or civilian register.'
    };
    const eraNote = eraOutfitContext[era] || '';

    // An explicit data.mode always wins. injuries.length === 0 is only a
    // fallback for the two older call sites (dg-agent-portal.html's
    // Medical Record/appearance-after-injury flows) that never set mode
    // at all -- for THEM, no injuries really did mean "nothing to draft
    // a post-injury prompt from, fall back to the face lock". But the
    // newer per-era Field Portrait / Field Reference buttons always send
    // mode explicitly AND always send injuries: [] (there's no medical
    // record involved in drafting those at all), so the old `||` short-
    // circuited isBase to true regardless of mode -- every Field
    // Reference (outfit, full-body) request silently got a Mode 0
    // headshot prompt back instead, with isOutfit below never reached.
    const isBase = data.mode === 'base' || (!data.mode && injuries.length === 0);
    const isOutfit = data.mode === 'outfit';
    const isSurveillance = data.mode === 'surveillance';

    // The age went in as a bare "Mid 30s" and no paragraph asked for it,
    // so the written prompt (and the Plate) usually lost it; it is now
    // labelled here and every mode's instructions require it.
    const ageText = String(char.age_range || '').trim();
    const ageLine = ageText ? 'Apparent age: ' + ageText.toLowerCase() : '';
    const ageRule = ageText
      ? 'State the apparent age plainly and early (for example "a ' + (char.sex === 'Female' ? 'woman' : char.sex === 'Male' ? 'man' : 'person') + ' in ' + (char.sex === 'Female' ? 'her' : char.sex === 'Male' ? 'his' : 'their') + ' ' + ageText.toLowerCase() + '"), and let it show in the face, skin and hair. '
      : '';
    const baseDesc = [
      ageLine, char.sex, char.nationality,
      'Build: ' + char.build,
      'Face: ' + [char.face_shape, char.eye_color + ' ' + char.eye_shape + ' eyes', char.nose, char.lips, char.skin].filter(Boolean).join(', '),
      'Hair: ' + [char.hair_color, char.hair_style, char.hair_texture].filter(Boolean).join(', '),
      char.facial_hair,
      char.face_scars ? 'Scars: ' + char.face_scars : '',
      char.body_markers ? 'Body markers: ' + char.body_markers : '',
      char.posture ? 'Posture: ' + char.posture : ''
    ].filter(Boolean).join('. ');

    const outfitDesc = isBase ? [char.jacket, char.shirt, char.trousers, char.footwear, char.accessories, char.jewelry].filter(Boolean).join(', ') : '';

    // What's actually visible from the chest up in a Mode 0 headshot --
    // the character's own jacket/shirt (outermost layer first, since a
    // jacket collar reads over a shirt collar), not the generic plain
    // black camisole/tank baseline the Banana Pro Director skill
    // defaults to for a brand-new character with no outfit on file yet.
    // Falls back to that same generic baseline only when neither field
    // is set (a character who hasn't filled in Cover Identity's outfit
    // fields at all) -- built as a full "wears ___" phrase rather than
    // a bare noun phrase, since the fallback already carries its own
    // article ("a plain black tank") that a "their own " prefix would
    // otherwise double up on ("their own a plain black tank").
    const topWearItems = [char.jacket, char.shirt].filter(Boolean).join(' over their ');
    const topWearDesc = topWearItems
      ? ('their own ' + topWearItems)
      : ('a plain black ' + (char.sex === 'Female' ? 'thin-strap camisole' : 'ribbed tank'));

    const injuryDesc = injuries.map(function(inj, i) {
      return (i + 1) + '. ' + inj.body_part + ' — ' + inj.injury + (inj.appearance ? '. Appearance impact: ' + inj.appearance : '');
    }).join('\n');

    let userPrompt;
    if (isBase) {
      // Mode 0 — Face lock. Canonical structure from Banana Pro Director 2.0 skill,
      // with the skill's own plain black camisole/tank baseline swapped for the
      // character's actual visible-from-the-chest-up clothing (jacket/shirt) --
      // this app's Agents already have real outfit data on file by this point, so
      // showing them in their own matching clothing here (rather than always
      // resetting to the generic wardrobe-free baseline) reads truer to the
      // character, and keeps the Field Portrait's outfit from looking like an
      // unrelated costume change against this same headshot.
      userPrompt = 'You are a Higgsfield / Banana Pro image prompt writer. '
        + 'Write a Mode 0 FACE LOCK prompt using the canonical Banana Pro Director structure. '
        + 'This is a 3:4 HEADSHOT from forehead to upper chest only. Face fills most of the frame. '
        + 'The character wears ' + topWearDesc + ', visible only from the chest up. '
        + 'Background is mid-gray seamless studio. Soft soft lighting from camera-left. '
        + 'Identity only -- no jewelry, no logos, no additional outfit styling beyond this collar/shoulder line.\n\n'
        + 'CHARACTER SPEC:\n' + baseDesc + '\n'
        + (char.facial_hair ? 'Facial hair: ' + char.facial_hair + '\n' : '')
        + (char.face_scars ? 'Identity markers: ' + char.face_scars + '\n' : '')
        + (char.expression ? 'Expression: ' + char.expression + '\n' : '')
        + (eraNote ? '\nERA CONTEXT: ' + eraNote + '\n' : '')
        + '\nWrite the prompt using this EXACT structure — two paragraphs, no preamble, no labels. ' + ageRule + '\n\n'
        + 'PARAGRAPH 1: Open with "A clean cinema-character-reference 3:4 headshot, framed from forehead to upper chest with the face filling most of the frame." '
        + 'Then: full identity description — apparent age, sex, heritage/nationality, build, skin tone and finish, hair (color, length, texture), face register (jaw, cheekbones, brow, eye shape and color, nose, lips), all identity markers. '
        + 'Then: wardrobe baseline, describing exactly this collar/shoulder line: "' + topWearDesc + ', no jewelry, no logos, no graphics." '
        + 'Then: "Body squared to camera, head level, neutral relaxed expression, eyes to camera, lips closed and relaxed, subtle controlled energy."\n\n'
        + 'PARAGRAPH 2: Open with "Mid-gray seamless studio background — even neutral mid-gray, no seam line, no gradient, no falloff to black or white." '
        + 'Then lighting: "Relight from scratch overriding any reference lighting: one broad diffused source from camera-left and slightly above, a soft triangle of light on the shadow cheek, gentle wrap onto the face, no hard shadow edges, no rim light, no hair light, no kicker." '
        + 'Then skin: "Skin reads matte and velvety — zero shine on forehead, nose bridge, cheekbones, temples, and chin, no oily T-zone — in a low-contrast milky look. Real peach fuzz at the jaw and hairline, real soft fine even pore texture, subsurface scattering reading as semi-translucent biology, never plastic, never waxy AI render, never glass-skin, never harsh — fine flattering texture that keeps the face looking good, no acne, no blemishes, no rough pores." '
        + 'Close with: "Photographed on a 50mm prime at a wide aperture, natural round bokeh, even sharpness, soft natural film grain. Photographed not generated."';

    } else if (isOutfit) {
      // Mode 1A — Single-image character outfit, Banana Pro path. Canonical structure from Banana Pro Director 2.0 skill.
      userPrompt = 'You are a Higgsfield / Banana Pro image prompt writer. '
        + 'Write a Mode 1A FULL-BODY OUTFIT REFERENCE prompt using the canonical Banana Pro Director structure. '
        + 'THIS IS A FULL-BODY SHOT — the ENTIRE figure must be visible from crown of head to soles of feet. '
        + 'DO NOT write a headshot. DO NOT crop at waist or chest. Feet and shoes must be visible. '
        + 'The character is in a model stance (weight on one hip, body angled 15-30 degrees from camera, eyes to camera). '
        + 'Background is mid-gray seamless studio. Soft soft lighting from camera-left.\n\n'
        + 'CHARACTER:\n' + baseDesc + '\n\n'
        + 'OUTFIT (document every item precisely — this is a wardrobe reference):\n'
        + [char.jacket, char.shirt, char.trousers, char.footwear, char.accessories, char.jewelry].filter(Boolean).join('\n') + '\n\n'
        + (eraNote ? 'ERA CONTEXT: ' + eraNote + '\n\n' : '')
        + (char.expression ? 'Expression/stance: ' + char.expression + '\n\n' : '')
        + 'Write the prompt using this EXACT structure — two paragraphs, no preamble, no labels:\n\n'
        + ageRule
        + 'PARAGRAPH 1: Full visual description of the character — apparent age and sex first, then hair, face briefly, then COMPLETE OUTFIT head-to-toe in order: '
        + 'jacket/outerwear, shirt/top, trousers/skirt, footwear, accessories, jewelry. '
        + 'Then pose: "Standing in a cocked-hip model stance, body angled [15-30] degrees from camera, weight shifted onto one hip, chin slightly tucked, eyes to camera, [expression]." '
        + 'NEVER mention headshot, portrait, chest-up, or upper body framing in this paragraph.\n\n'
        + 'PARAGRAPH 2: Open with "Mid-gray seamless studio background — even neutral mid-gray, no seam line, no gradient, no falloff to black or white." '
        + 'Lighting: "Relight from scratch overriding any reference lighting: one broad diffused source from camera-left and slightly above, gentle wrap onto the figure, no harsh shadows, no rim light, no hair light, no kicker, only the gentlest lifted shadow on the off-light side." '
        + 'Skin/fabric: "Skin and fabric read matte and velvety in a low-contrast milky look, no shine. Real fine even pore texture, subsurface scattering, real fabric weave and drape, never plastic, never waxy, never harsh." '
        + 'Close with: "Photographed on a 50mm prime at a wide aperture, natural round bokeh, even sharpness, soft natural film grain. Full body visible head to sole. Photographed not generated."';
    } else if (isSurveillance) {
      const scene = data.scene || '';
      const operation = data.operation || '';
      const location = data.location || '';
      const charCtx = data.char_context || '';
      userPrompt = 'You are a Banana Pro / Higgsfield AI cinematic prompt writer specialising in photorealistic surveillance and field photography.\n\n'
        + 'Write a cinematic surveillance photo prompt based on this after-action report scene.\n\n'
        + (operation ? 'OPERATION: ' + operation + '\n' : '')
        + (location ? 'LOCATION: ' + location + '\n' : '')
        + (charCtx ? 'AGENT: ' + charCtx + '\n' : '')
        + '\nSCENE DESCRIPTION:\n' + scene + '\n\n'
        + 'Write only the image prompt. 2-3 paragraphs. '
        + 'Focus on: environment and setting, lighting conditions (time of day, artificial/natural), camera angle and distance, atmospheric mood, grain and film aesthetic. '
        + 'If the agent is in the scene describe their positioning and body language. '
        + 'This should read like a surveillance photo or field documentation still — gritty, real, not staged.';
    } else {
      userPrompt = 'You are a Banana Pro / Higgsfield AI cinematic prompt writer specialising in photorealistic character references.\n\n'
        + 'Write a Mode 3 full-body appearance prompt for this Delta Green agent as they look RIGHT NOW, after their injuries. '
        + 'They are in a hospital or medical facility, wearing plain hospital clothes (hospital gown or scrubs — no tactical gear, no mission outfit). '
        + 'The prompt must incorporate all appearance impact notes from the medical record.\n\n'
        + 'BASE CHARACTER:\n' + baseDesc + '\n\n'
        + 'MEDICAL RECORD — APPEARANCE IMPACTS:\n' + (injuryDesc || 'None on file.') + '\n\n'
        + ageRule
        + 'Write only the image prompt. 2-3 paragraphs. Photorealistic, clinical lighting, full body visible. '
        + 'Begin with the physical description, end with lighting and camera notes.';
    }

    return userPrompt;
}

module.exports = { buildAppearancePrompt };
