/* ══════════════════════════════════════════════
   APPEARANCE GENERATOR -- the Random Agent Generator's tables and
   generateAgent(), shared by the Agent File's Appearance brief
   (assets/agent-file.js) and the character sheet's Appearance section
   and wizard step (stats/appearance-sheet.js). Classic script on
   purpose: agent-file.js uses ARCHETYPES / generateAgent() as globals,
   as the Agent Portal did.

     generateAgent(archetypeId?) -> { char_name, sex, face_shape, ... }
     window.dgAppearanceGen = { ARCHETYPES, RAND_TABLES, generate }
   ══════════════════════════════════════════════ */
const ARCHETYPES = [
  { id:'fed',       label:'Federal Agent'            },
  { id:'cop',       label:'Police Officer'           },
  { id:'mil',       label:'Special Operator'         },
  { id:'soldier',   label:'Soldier or Marine'        },
  { id:'doc',       label:'Physician'                },
  { id:'medic',     label:'Nurse or Paramedic'       },
  { id:'academic',  label:'Anthropologist'           },
  { id:'scientist', label:'Scientist'                },
  { id:'spook',     label:'Intelligence Officer'     },
  { id:'caseofficer',label:'Intelligence Case Officer'},
  { id:'criminal',  label:'Criminal'                 },
  { id:'reporter',  label:'Media Specialist'         },
  { id:'lawyer',    label:'Lawyer'                   },
  { id:'pilot',     label:'Pilot or Sailor'          },
  { id:'engineer',  label:'Computer Scientist'       },
  { id:'fso',       label:'Foreign Service Officer'  },
  { id:'firefighter',label:'Firefighter'             },
  { id:'program',   label:'Program Manager'          },
  // The Complex's professions: each starts from the closest Handbook
  // look (`base`) with its own clothing on top (COMPLEX_LOOKS below).
  { id:'cbp_marine',   label:'Marine Interdiction Agent',            group:'Customs & Border Protection', base:'fed' },
  { id:'cbp_bortac',   label:'Border Tactical Unit Operator',        group:'Customs & Border Protection', base:'mil' },
  { id:'cbp_borstar',  label:'Search, Trauma & Rescue Agent',        group:'Customs & Border Protection', base:'medic' },
  { id:'atf_medic',    label:'Tactical Medic',                       group:'ATF', base:'medic' },
  { id:'atf_tactical', label:'Tactical Operator',                    group:'ATF', base:'mil' },
  { id:'atf_analyst',  label:'Criminal Investigative Analyst',       group:'ATF', base:'spook' },
  { id:'atf_explosives',label:'Explosives Specialist',               group:'ATF', base:'fed' },
  { id:'usss_ppd',     label:'Protective Detail Agent',              group:'Secret Service', base:'fed' },
  { id:'usss_cat',     label:'Counter Assault Team Operator',        group:'Secret Service', base:'mil' },
  { id:'uscg_sar',     label:'Search and Rescue Swimmer',            group:'Coast Guard', base:'soldier' },
  { id:'uscg_hitron',  label:'Helicopter Interdiction Sniper',       group:'Coast Guard', base:'mil' },
  { id:'uscg_taclet',  label:'Tactical Law Enforcement Team Member', group:'Coast Guard', base:'soldier' },
  { id:'uscg_msst',    label:'Maritime Safety & Security Team Member', group:'Coast Guard', base:'soldier' },
  { id:'uscg_msrt',    label:'Maritime Security Response Operator',  group:'Coast Guard', base:'mil' },
  { id:'nsa_crypto',   label:'Cryptanalyst',                         group:'NSA', base:'engineer' },
  { id:'nsa_tao',      label:'Tailored Access Operations Hacker',    group:'NSA', base:'engineer' },
  { id:'nsa_remote',   label:'Remote Device Technician',             group:'NSA', base:'spook' },
  { id:'nps_interpretive', label:'Interpretive Ranger',              group:'National Park Service', base:'academic' },
  { id:'nasa_astronaut', label:'Astronaut',                          group:'NASA', base:'pilot' },
  { id:'contractor_targeting', label:'Targeting Officer',            group:'Contractors (CACI / Booz Allen)', base:'spook' },
];
ARCHETYPES.forEach(function (a) { if (!a.group) a.group = "Agent's Handbook"; });

// Clothing for The Complex's professions (our own ideas of what each
// wears off duty or on a quiet day), over its base look.
const COMPLEX_LOOKS = {
  cbp_marine:   { jacket:['navy waterproof boat jacket, agency patch removed','salt-stained softshell'], footwear:['non-slip deck boots','worn boat shoes'], accessories:['sunglasses on a retainer cord','dry bag slung over a shoulder'] },
  cbp_bortac:   { jacket:['desert-tan softshell','faded olive field jacket'], trousers:['tan tactical pants','sun-bleached cargo pants'], accessories:['wide-brimmed boonie hat','hydration pack straps'] },
  cbp_borstar:  { jacket:['rescue-orange softshell, faded','tan field jacket'], accessories:['trauma shears clipped to a pocket','radio harness'] },
  atf_medic:    { jacket:['black windbreaker, yellow letters removed'], accessories:['tourniquet in a belt pouch','medic shears on a lanyard'] },
  atf_tactical: { jacket:['black softshell, no markings'], trousers:['black tactical pants'], accessories:['plate-carrier strap marks on the shoulders','sidearm in a drop holster'] },
  atf_analyst:  { jacket:['plain gray blazer','navy cardigan'], shirt:['button-down, sleeves rolled','turtleneck'], accessories:['reading glasses pushed up','case binders under one arm'] },
  atf_explosives:{ jacket:['canvas work jacket','dark windbreaker'], accessories:['bomb-tech pin on the lapel','toolkit roll in a back pocket'] },
  usss_ppd:     { jacket:['dark suit jacket cut loose for a holster'], shirt:['white dress shirt, dark tie'], accessories:['clear coiled earpiece','lapel pin of the day'], jewelry:['plain steel watch'] },
  usss_cat:     { jacket:['black tactical jacket'], trousers:['black BDU pants'], accessories:['earpiece and throat mic','black ballcap, no logo'] },
  uscg_sar:     { jacket:['orange-trimmed rescue jacket','Coast Guard sweatshirt, faded'], shirt:['rash guard under a hoodie'], footwear:['dive booties tied to a bag','running shoes'], accessories:['swim fins hooked to a pack'] },
  uscg_hitron:  { jacket:['olive flight jacket'], accessories:['aviator sunglasses','headset dents in the hair'] },
  uscg_taclet:  { jacket:['blue operational jacket, rank removed'], accessories:['boarding gloves in a back pocket'] },
  uscg_msst:    { jacket:['navy foul-weather jacket'], footwear:['deck boots'], accessories:['knit watch cap'] },
  uscg_msrt:    { jacket:['black softshell'], trousers:['black tactical pants'], accessories:['wet-suit tan lines','dive watch'] },
  nsa_crypto:   { jacket:['shapeless fleece','cardigan with stretched pockets'], shirt:['math-joke t-shirt','plaid button-down'], accessories:['badge on a lanyard, tucked away','pencil behind the ear'] },
  nsa_tao:      { jacket:['black hoodie','conference-swag zip-up'], shirt:['band t-shirt'], accessories:['noise-canceling headphones around the neck','laptop full of stickers'] },
  nsa_remote:   { jacket:['utility jacket full of pockets'], accessories:['electronics toolkit pouch','spare SIM cards in a tin'] },
  nps_interpretive:{ jacket:['ranger fleece, park patch','green-gray field jacket'], shirt:['gray ranger shirt'], accessories:['flat hat in hand','binoculars on a strap'], footwear:['broken-in hiking boots'] },
  nasa_astronaut:{ jacket:['blue flight jacket with mission patches','NASA windbreaker'], shirt:['polo with a mission logo'], accessories:['aviator watch','lanyard of center badges'] },
  contractor_targeting:{ jacket:['quarter-zip pullover, company logo','business-casual blazer'], shirt:['company polo','oxford, no tie'], accessories:['clearance badge clipped to the belt','government-issue laptop bag'] }
};


const RAND_TABLES = {

  /* ── NAMES ── */
  first_m: ['James','Robert','Michael','William','David','Richard','Thomas','Charles','Daniel','Edward',
            'Frank','Gary','Harold','Ivan','Jack','Karl','Leonard','Marcus','Nathan','Oscar',
            'Paul','Raymond','Samuel','Theodore','Victor','Walter','Arthur','Bernard','Carl','Dennis'],
  first_f: ['Mary','Patricia','Jennifer','Linda','Barbara','Susan','Jessica','Sarah','Karen','Nancy',
            'Lisa','Betty','Dorothy','Sandra','Ashley','Kimberly','Donna','Emily','Carol','Ruth',
            'Sharon','Michelle','Laura','Helen','Anna','Diane','Christine','Debra','Rachel','Carolyn'],
  last: ['Anderson','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson','Moore',
         'Taylor','Thomas','Jackson','White','Harris','Martin','Thompson','Martinez','Robinson','Clark',
         'Rodriguez','Lewis','Lee','Walker','Hall','Allen','Young','Hernandez','King','Wright',
         'Lopez','Hill','Scott','Green','Adams','Baker','Nelson','Carter','Mitchell','Perez'],

  /* ── CODENAMES ── */
  codenames: ['WATCHER','QUARRY','STATIC','DAGGER','PARISH','WREN','FOXHOLE','BURDEN',
              'PILGRIM','SPARROW','LANTERN','COMPASS','RIDGELINE','ORACLE','CIPHER','ANCHOR',
              'VAGRANT','EMBERS','CURRENT','HOLLOW','ECLIPSE','SENTINEL','NOMAD','THRESHOLD',
              'REMNANT','AXIOM','TURNKEY','VESPER','CARDINAL','GUTTER'],

  /* ── AGE ── */
  age: ['Early 30s','Mid 30s','Late 30s','Early 40s','Mid 40s','Late 40s','Early 50s','Mid 50s'],

  /* ── NATIONALITY ── */
  nationality: [
    'White American','White American','White American',
    'African American','African American',
    'Hispanic American','Hispanic American',
    'Asian American',
    'Native American',
    'Irish American','Italian American','Polish American',
    'Russian American','Cuban American','Vietnamese American',
  ],

  /* ── FACE SHAPE ── */
  face_shape: [
    'broad and flat, heavy jaw','angular with prominent cheekbones','round and fleshy, soft jaw',
    'long and narrow, sharp features','square jaw, wide forehead','gaunt, hollowed cheeks',
    'oval with strong brow ridge','wedge-shaped, wide at temples','asymmetrical, slightly lopsided jaw',
    'wide-set features, flat nose bridge',
  ],

  /* ── EYES ── */
  eye_color: ['pale blue','steel gray','dark brown','hazel','green','amber','near-black','light brown','gray-green','ice blue'],
  eye_shape: ['deep-set','hooded','wide-set','narrow and watchful','sunken','prominent','slightly asymmetrical','heavy-lidded'],

  /* ── NOSE ── */
  nose: ['broad and flat','straight and prominent','crooked — broken at least once','bulbous tip',
         'thin and sharp','wide nostrils','hawkish and curved','small and upturned','large with visible pores'],

  /* ── LIPS ── */
  lips: ['thin and tight','wide and downturned','full, rarely smiling','cracked and dry',
         'thin upper lip, fuller lower','wide and mobile','compressed into a line'],

  /* ── SKIN ── */
  skin: [
    'pale, sun-starved, visible veins','ruddy and weathered, broken capillaries',
    'warm brown, even tone','deep brown, ashy in cold weather','olive, Mediterranean cast',
    'dark with yellow undertone','pale with heavy freckling','blotchy, rosacea patches',
    'leathery from years outdoors','sallow, unhealthy yellow cast',
  ],

  /* ── FACIAL HAIR (male) ── */
  facial_hair_male: [
    'clean-shaven, always','heavy five-o-clock shadow, never fully shaved',
    'full beard, unkempt','neat mustache','handlebar mustache, well-maintained',
    'thin goatee','stubble that never grows into a beard',
    'clean-shaven with a visible nick scar','mutton chops','week-old stubble',
  ],

  /* ── FACIAL HAIR (female) ── */
  facial_hair_female: [
    'none', 'none', 'none', 'none',
    'none, meticulous about it',
    'faint, barely visible — never remarked on',
  ],

  /* ── HAIR COLOR ── */
  hair_color: [
    'dirty blond going gray at the temples','jet black','salt-and-pepper, mostly salt',
    'dark brown with a thread of gray','ginger-red fading to strawberry blond',
    'steel gray','pure white — too young for it','auburn','close-cropped black',
    'dishwater blond','brown shot through with premature gray',
  ],

  /* ── HAIR STYLE (male) ── */
  hair_style_male: [
    'short back and sides, slightly grown out','military cut, fading at sides',
    'side-swept, needs cutting','close-cropped, nearly shaved',
    'slicked back with something greasy',
    'thinning on top, compensated for','short and practical, no styling',
    'buzzcut','mid-length, pushed behind the ears',
  ],

  /* ── HAIR STYLE (female) ── */
  hair_style_female: [
    'shoulder-length, worn loose','long, tied back in a practical braid',
    'chin-length bob, no-nonsense','pulled back in a tight, functional bun',
    'short and practical, choppy layers','high ponytail, functional',
    'pixie cut, easy to maintain','long, usually pinned up out of the way',
    'undercut, longer on top','natural curls, kept short for practicality',
  ],

  /* ── HAIR TEXTURE ── */
  hair_texture: ['straight and fine','coarse and straight','wavy','tightly coiled','loosely curled','wiry'],

  /* ── BUILD ── */
  build: [
    'lean and wiry — sinew, not muscle','broad-shouldered, running to fat',
    'compact and low-slung, dense','rangy, all limbs','soft, lost the shape years ago',
    'stocky, former athlete','tall and thin, stooped','heavyset with thick neck',
    'average in every dimension — impossible to describe','muscular but carrying a gut',
  ],

  /* ── POSTURE ── */
  posture: [
    'upright and watchful, never relaxes','slightly hunched, protective of the chest',
    'military straight — always','leans against things, never stands free',
    'walks with a slight limp','restless, always in motion','coiled — springs forward when moving',
    'slow and deliberate, takes up space','forward-leaning, aggressive default',
    'collapsed inward, defeated-looking',
  ],

  /* ── EXPRESSION ── */
  expression: [
    'flat and unreadable, studies everything','tightly wound, jaw working',
    'vaguely amused, nothing surprises him','thousand-yard stare, not there',
    'watchful and suspicious, cataloguing the room','tired — permanently, bone-deep',
    'deadpan, occasionally terrifying','falsely pleasant — smile never reaches the eyes',
    'grim set to the mouth, resigned','looks like he forgot something important',
  ],

  /* ── SCARS ── */
  face_scars: [
    '','','','','',  // most agents: no visible face scars
    'thin scar through left eyebrow','burn scarring along the jawline',
    'small puckered scar at corner of mouth','broken nose, healed crooked',
    'faded scar across the bridge of the nose','nick at the earlobe, old knife wound',
  ],

  /* ── BODY MARKERS ── */
  body_markers: [
    '','','',  // many: none
    'service tattoo on upper arm, faded','knife scar on the forearm',
    'burn scar on the right hand','old bullet entry scar, shoulder','heavy knuckle scarring',
    'military tattoo sleeve, partially visible','track marks, old and healed',
  ],

  /* ── VIBE ── */
  vibe: [
    'Like being watched by someone who already knows what you did.',
    'The kind of person you notice leaving a room before you notice them enter it.',
    'Competent in a way that makes you feel incompetent.',
    'You get the sense he\'s seen worse. Much worse. And he\'s still standing.',
    'She makes the room smaller just by being in it.',
    'Something behind the eyes that wasn\'t always there.',
    'Radiates the specific exhaustion of someone who stopped caring about the wrong things.',
    'You wouldn\'t lie to him. Not because he\'d know — because you wouldn\'t want to.',
    'Presence like a closed door.',
    'The kind of quiet that comes after something very loud.',
  ],

  /* ── ARCHETYPE OVERRIDES ── */
  archetype_overrides: {

    cop: {
      jacket: ['battered leather jacket over a hoodie','worn canvas field jacket','cheap suit jacket, ill-fitting',
               'fleece-lined flannel shirt worn open','stained waterproof parka'],
      shirt:  ['faded department t-shirt under everything','flannel shirt','wrinkled oxford, collar open',
               'thermals showing at the wrist','polo shirt with a coffee stain'],
      trousers:['dark jeans, cargo pockets','tactical pants, civilian brand','chinos, seen better days','worn corduroys'],
      footwear:['scuffed leather shoes','broken-in trail runners','steel-toed work boots','old patrol boots, resoled'],
      accessories:['shoulder holster worn even off-duty','detective shield clipped to belt',
                   'worn leather wallet on a chain','radio clip empty on the hip'],
      jewelry:['plain gold wedding band — or the tan line where it was','cheap analog watch, department issue'],
      expression_bias: ['tightly wound, jaw working','watchful and suspicious, cataloguing the room',
                        'deadpan, occasionally terrifying','tired — permanently, bone-deep'],
    },

    fed: {
      jacket: ['dark navy suit jacket','off-the-rack blazer','charcoal suit jacket','black windbreaker with no markings'],
      shirt:  ['white dress shirt, tie loosened','light blue oxford','gray dress shirt','white shirt, sleeves rolled'],
      trousers:['matching suit trousers','dark dress pants','navy chinos'],
      footwear:['black leather oxfords, always polished','dark brown cap-toes','plain service shoes'],
      accessories:['shoulder holster under the jacket','credentials wallet, breast pocket','government-issue lanyard, pocketed'],
      jewelry:['plain watch, government standard','no jewelry — policy'],
      expression_bias: ['flat and unreadable, studies everything','falsely pleasant — smile never reaches the eyes',
                        'upright and watchful, never relaxes'],
    },

    mil: {
      jacket: ['military surplus field jacket, unit patches removed','ACU jacket, civvie buttons','worn Carhartt','canvas work jacket'],
      shirt:  ['army surplus t-shirt','olive drab crew neck','plain gray t-shirt','unit t-shirt, faded'],
      trousers:['cargo pants, olive or khaki','BDU bottoms in civilian cut','dark jeans, worn at the knee'],
      footwear:['military-grade boots, still polished','Bates tactical boots','combat boots, non-regulation color'],
      accessories:['dog tags under the shirt','worn nylon rigger belt','challenge coin in the pocket'],
      jewelry:['no jewelry — never got the habit back','POW/MIA bracelet'],
      expression_bias: ['military straight — always','coiled — springs forward when moving',
                        'flat and unreadable, studies everything'],
    },

    doc: {
      jacket: ['gray tweed jacket over everything','navy cardigan','rain jacket','worn blazer with elbow patches'],
      shirt:  ['chambray shirt, collar frayed','oxford button-down','plain cotton shirt, tucked','turtleneck'],
      trousers:['dark corduroy','gray wool trousers','dark chinos, practical'],
      footwear:['rubber-soled dress shoes','worn loafers','waterproof walking shoes'],
      accessories:['medical bag always nearby','pen light clipped to pocket','nitrile gloves in jacket pocket'],
      jewelry:['medical alert tag','plain watch, accurate to the second'],
      expression_bias: ['competent in a way that makes you feel incompetent','tired — permanently, bone-deep',
                        'vaguely amused, nothing surprises him'],
    },

    academic: {
      jacket: ['rumpled blazer, always','corduroy jacket','old field coat, pockets full','fleece vest over everything'],
      shirt:  ['Oxford button-down, untucked','flannel shirt','plain t-shirt under everything','henley'],
      trousers:['chinos in earth tones','worn cords','khakis, permanent crease gone','dark jeans'],
      footwear:['deck shoes or loafers','worn hiking boots','battered oxford shoes'],
      accessories:['notebook always in hand','messenger bag, overstuffed','reading glasses pushed up'],
      jewelry:['no jewelry, loses things','university ring, worn down'],
      expression_bias: ['vaguely amused, nothing surprises him','looks like he forgot something important',
                        'radiates the specific exhaustion of someone who stopped caring about the wrong things'],
    },

    spook: {
      jacket: ['unremarkable gray jacket — the point is to be forgettable','expensive coat worn cheap',
               'whatever fits the environment','blazer in a neutral that photographs badly'],
      shirt:  ['plain white or gray','whatever doesn\'t stand out','monochrome, always'],
      trousers:['dark slacks','dark jeans, pressed','khakis — same reason'],
      footwear:['soft-soled shoes, quiet on floors','comfortable walking shoes, no squeak'],
      accessories:['nothing on the outside','burner phone, secondary pocket'],
      jewelry:['none — nothing that can be used to identify or track'],
      expression_bias: ['flat and unreadable, studies everything','falsely pleasant — smile never reaches the eyes',
                        'presence like a closed door'],
    },

    criminal: {
      jacket: ['oversized Carhartt, stained','track jacket, wrong brand','hoodie under a vest','puffer jacket, logo removed'],
      shirt:  ['graphic tee, reference obscure','ribbed tank top under the jacket','flannel, half-buttoned','plain white v-neck'],
      trousers:['dark jeans, belted low','cargo shorts or pants','track pants'],
      footwear:['fresh sneakers — only thing that is','work boots','scuffed leather shoes, expensive once'],
      accessories:['phone always visible','prepaid burner plus personal phone','cash only, rubber-banded'],
      jewelry:['gold chain, real or fake, hard to tell','ring on the wrong finger','earring, single'],
      expression_bias: ['vaguely amused, nothing surprises him','restless, always in motion',
                        'you wouldn\'t lie to him'],
    },

    reporter: {
      jacket: ['light field jacket, pockets full','raincoat, press credentials inside','blazer over jeans'],
      shirt:  ['practical button-down, tucked in','plain t-shirt, clean','chambray, sleeves rolled'],
      trousers:['dark jeans','khakis','practical slacks'],
      footwear:['comfortable walking shoes — miles per day','trail runners','flat leather shoes'],
      accessories:['recorder in the pocket','notebook and pen, always','press badge lanyard'],
      jewelry:['minimal — nothing to snag','simple watch'],
      expression_bias: ['like being watched by someone who already knows what you did',
                        'something behind the eyes that wasn\'t always there','vaguely amused, nothing surprises him'],
    },

    soldier: {
      jacket: ['worn field jacket, rank removed','army surplus parka','canvas work jacket'],
      shirt:  ['olive drab t-shirt','plain gray crew neck','army surplus thermal'],
      trousers:['BDU-cut cargo pants, olive','dark work pants','worn jeans'],
      footwear:['steel-toed boots, resoled twice','military surplus boots','tactical boots, black'],
      accessories:['rigger belt, nylon','challenge coin, front pocket','dog tags tucked in'],
      jewelry:['nothing','POW-MIA bracelet, worn smooth'],
      expression_bias: ['flat and unreadable, studies everything','coiled, springs forward when moving','tired, permanently, bone-deep'],
    },
    medic: {
      jacket: ['dark scrub jacket','navy fleece over everything','plain windbreaker'],
      shirt:  ['scrub top, non-descript color','plain cotton shirt','oxford, sleeves rolled to the elbow'],
      trousers:['dark scrub pants','plain chinos','dark jeans'],
      footwear:['rubber-soled shoes, quiet on floors','clean white trainers','comfortable flats'],
      accessories:['pen light in breast pocket','nitrile gloves in jacket pocket','small trauma kit nearby'],
      jewelry:['nothing sharp or grabable','plain stud earrings','plain watch'],
      expression_bias: ['tired, permanently, bone-deep','radiates the specific exhaustion of someone who stopped caring about the wrong things','competent in a way that makes you feel incompetent'],
    },
    scientist: {
      jacket: ['rumpled blazer, always','old field coat, pockets full','fleece vest over everything'],
      shirt:  ['oxford button-down, half-untucked','plain t-shirt under everything','flannel'],
      trousers:['chinos in earth tones','worn cords','dark jeans'],
      footwear:['deck shoes or loafers','worn hiking boots','battered oxfords'],
      accessories:['notebook always somewhere','too many pens','reading glasses pushed up'],
      jewelry:['none','university ring, worn down'],
      expression_bias: ['vaguely amused, nothing surprises him','looks like he forgot something important','radiates the specific exhaustion of someone who stopped caring about the wrong things'],
    },
    caseofficer: {
      jacket: ['unremarkable blazer in a neutral','expensive coat worn cheap','whatever fits the environment'],
      shirt:  ['plain white or gray, always','monochrome, always','whatever does not stand out'],
      trousers:['dark pressed slacks','dark jeans, pressed','khakis'],
      footwear:['soft-soled shoes, quiet on floors','comfortable walking shoes, no squeak'],
      accessories:['nothing visible','burner phone in secondary pocket','credentials in interior pocket'],
      jewelry:['none'],
      expression_bias: ['flat and unreadable, studies everything','falsely pleasant, smile never reaches the eyes','presence like a closed door'],
    },
    lawyer: {
      jacket: ['dark suit jacket, good cut','charcoal blazer','navy suit jacket'],
      shirt:  ['white dress shirt, open collar','blue oxford, tie loosened','plain white, impeccable'],
      trousers:['matching suit trousers','dark dress pants'],
      footwear:['black cap-toes, always polished','dark brown oxfords'],
      accessories:['leather portfolio','phone always visible','expensive watch, understated'],
      jewelry:['simple wedding band','no jewelry, deliberate'],
      expression_bias: ['falsely pleasant, smile never reaches the eyes','presence like a closed door','competent in a way that makes you feel incompetent'],
    },
    pilot: {
      jacket: ['flight jacket, worn leather','navy bomber','canvas field jacket'],
      shirt:  ['plain polo shirt','oxford button-down','plain t-shirt'],
      trousers:['dark chinos','khakis','plain dark jeans'],
      footwear:['clean leather lace-ups','dark boots','plain trainers'],
      accessories:['aviator watch, analog','sunglasses always on or in hand'],
      jewelry:['nothing that could snag','simple wedding band'],
      expression_bias: ['upright and watchful, never relaxes','vaguely amused, nothing surprises him','flat and unreadable, studies everything'],
    },
    engineer: {
      jacket: ['dark fleece vest','plain hoodie, logo faded','plain zip-up jacket'],
      shirt:  ['plain t-shirt, crew neck','oxford, untucked','flannel'],
      trousers:['dark jeans','chinos','cargo pants, practical'],
      footwear:['clean trainers','comfortable slip-ons','worn sneakers'],
      accessories:['phone always in hand','laptop bag nearby','earbuds around neck'],
      jewelry:['none','simple rubber band on wrist'],
      expression_bias: ['vaguely amused, nothing surprises him','looks like he forgot something important','radiates the specific exhaustion of someone who stopped caring about the wrong things'],
    },
    fso: {
      jacket: ['linen blazer, well-travelled','dark suit jacket','light field coat'],
      shirt:  ['oxford button-down','plain white or blue dress shirt','linen shirt, collar open'],
      trousers:['dress pants','dark chinos'],
      footwear:['comfortable walking shoes, broken in','leather oxfords','plain loafers'],
      accessories:['diplomatic passport nearby','business cards in breast pocket'],
      jewelry:['nothing that reads as foreign','simple watch, conservative'],
      expression_bias: ['falsely pleasant, smile never reaches the eyes','vaguely amused, nothing surprises him','flat and unreadable, studies everything'],
    },
    firefighter: {
      jacket: ['heavy canvas work jacket','department hoodie, washed many times','plain work coat'],
      shirt:  ['department t-shirt, faded','plain work shirt','thermal undershirt showing at cuffs'],
      trousers:['dark work pants, reinforced knees','cargo pants','thick jeans'],
      footwear:['steel-toed boots, heavy','work boots, worn at the toe'],
      accessories:['pager clipped to belt','carabiner with too many keys'],
      jewelry:['nothing','plain wedding band, left home on shift days'],
      expression_bias: ['upright and watchful, never relaxes','coiled, springs forward when moving','slow and deliberate, takes up space'],
    },
    program: {
      jacket: ['dark blazer, off-the-rack','navy jacket, always','charcoal cardigan'],
      shirt:  ['white oxford, always pressed','plain blue dress shirt','light gray, conservative'],
      trousers:['dark dress pants','matching suit trousers'],
      footwear:['plain black leather shoes','dark brown oxfords'],
      accessories:['government-issue lanyard, pocketed','leather folio under arm'],
      jewelry:['plain watch, analog','wedding band or none'],
      expression_bias: ['falsely pleasant, smile never reaches the eyes','flat and unreadable, studies everything','slow and deliberate, takes up space'],
    },
  },

  /* ── GENERIC OUTFIT TABLES (non-archetypee) ── */
  jacket: ['worn leather jacket, dark','surplus field jacket, oil-stained','cheap suit jacket',
           'canvas barn jacket','dark windbreaker, no markings','heavy wool overcoat',
           'knit cardigan over everything','puffer vest, functional only','flannel shirt worn open as jacket'],
  shirt:  ['plain gray t-shirt','oxford button-down, collar open','thermal undershirt',
           'faded work shirt','polo shirt, wrong size','henley, long-sleeved','plain white tee'],
  trousers:['dark jeans','cargo pants','worn chinos','black dress pants, permanent crease',
            'work pants, stained at the knees','faded corduroys'],
  footwear:['black leather shoes, scuffed','work boots, steel-toed','trail runners, gray',
            'battered loafers','tactical boots, civilian color','old sneakers'],
  accessories:['nothing that stands out','worn leather belt, no buckle worth noting',
               'keychain with too many keys','single prepaid phone'],
  jewelry:['nothing','plain analog watch','simple wedding band','no jewelry at all'],
};

function rnd(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// opts.sex: keep this Agent's own (Male / Female / Other) instead of rolling one.
function generateAgent(archetypeId, opts) {
  const given = opts && opts.sex;
  const sex = given === 'Male' || given === 'Female' ? given : given === 'Other' ? (Math.random() > 0.5 ? 'Male' : 'Female') : (Math.random() > 0.55 ? 'Male' : 'Female');
  const firstName = sex === 'Male' ? rnd(RAND_TABLES.first_m) : rnd(RAND_TABLES.first_f);
  const lastName = rnd(RAND_TABLES.last);

  // A Complex profession: its base look with its own clothing on top.
  const arch = archetypeId ? ARCHETYPES.filter(function (a) { return a.id === archetypeId; })[0] : null;
  const baseO = arch && arch.base ? RAND_TABLES.archetype_overrides[arch.base] : null;
  const ownO = archetypeId ? (RAND_TABLES.archetype_overrides[archetypeId] || COMPLEX_LOOKS[archetypeId]) : null;
  const ao = baseO || ownO ? Object.assign({}, baseO || {}, ownO || {}) : null;

  const expressionPool = ao?.expression_bias
    ? [...ao.expression_bias, ...RAND_TABLES.expression]
    : RAND_TABLES.expression;

  return {
    char_name:   firstName + ' ' + lastName,
    codename:    rnd(RAND_TABLES.codenames),
    age_range:   rnd(RAND_TABLES.age),
    sex:         sex,
    nationality: rnd(RAND_TABLES.nationality),
    face_shape:  rnd(RAND_TABLES.face_shape),
    eye_color:   rnd(RAND_TABLES.eye_color),
    eye_shape:   rnd(RAND_TABLES.eye_shape),
    nose:        rnd(RAND_TABLES.nose),
    lips:        rnd(RAND_TABLES.lips),
    skin:        rnd(RAND_TABLES.skin),
    facial_hair: rnd(sex === 'Female' ? RAND_TABLES.facial_hair_female : RAND_TABLES.facial_hair_male),
    face_scars:  rnd(RAND_TABLES.face_scars),
    hair_color:  rnd(RAND_TABLES.hair_color),
    hair_style:  rnd(sex === 'Female' ? RAND_TABLES.hair_style_female : RAND_TABLES.hair_style_male),
    hair_texture:rnd(RAND_TABLES.hair_texture),
    build:       rnd(RAND_TABLES.build),
    posture:     rnd(RAND_TABLES.posture),
    body_markers:rnd(RAND_TABLES.body_markers),
    jacket:      rnd(ao?.jacket || RAND_TABLES.jacket),
    shirt:       rnd(ao?.shirt  || RAND_TABLES.shirt),
    trousers:    rnd(ao?.trousers || RAND_TABLES.trousers),
    footwear:    rnd(ao?.footwear || RAND_TABLES.footwear),
    accessories: rnd(ao?.accessories || RAND_TABLES.accessories),
    jewelry:     rnd(ao?.jewelry || RAND_TABLES.jewelry),
    expression:  rnd(expressionPool),
    vibe:        rnd(RAND_TABLES.vibe),
  };
}


window.dgAppearanceGen = { ARCHETYPES: ARCHETYPES, RAND_TABLES: RAND_TABLES, COMPLEX_LOOKS: COMPLEX_LOOKS, generate: generateAgent };
