/* The New Recruit wizard's data (assets/recruit-wizard.js): statistics
   explained, distinguishing features to suggest, The Complex's professions
   and agency postings, starting kits, Bond lists and Damaged Veteran.

   Numbers (skills, percentages, Bonds) follow the Agent's Handbook and
   Delta Green: The Complex; every description here is our own wording --
   the site is public, no rulebook text is copied. The Handbook's 18
   professions themselves come from stats/professions.js (`professions`).

   window.dgRecruitData */
(function () {
  'use strict';
  if (window.dgRecruitData) return;

  /* ── Statistics: what each one does, and features to suggest ── */
  var STAT_INFO = {
    STR: { name: 'Strength', what: 'Physical power: lifting, shoving, hitting hard, forcing a door. With CON it sets Hit Points.',
      low: ['Slight build, tires quickly when lifting', 'Weak grip', 'Struggles with heavy doors'],
      mid: ['Average build, no gym habit', 'Fit enough for the job', 'Carries more than they look like they could'],
      high: ['Powerfully built', 'Lifts weights daily', 'Hands like shovels', 'Broad shoulders, thick neck'] },
    CON: { name: 'Constitution', what: 'Health and stamina: shrugging off injury, illness, poison and exhaustion. With STR it sets Hit Points.',
      low: ['Sickly, always fighting a cold', 'Short of breath on stairs', 'Pale and tired-looking'],
      mid: ['Rarely gets sick', 'Sleeps badly but copes', 'Average stamina'],
      high: ['Never takes a sick day', 'Marathon runner', 'Recovers fast from anything', 'Iron stomach'] },
    DEX: { name: 'Dexterity', what: 'Coordination, speed and reflexes: dodging, steady hands, quick reactions. Sets the order in a fight.',
      low: ['Clumsy, drops things', 'Slow to react', 'Stiff, awkward movements'],
      mid: ['Steady hands', 'Moves without wasted effort', 'Decent reflexes'],
      high: ['Catlike reflexes', 'Fast hands', 'Moves without a sound', 'Never seems off balance'] },
    INT: { name: 'Intelligence', what: 'Reasoning, memory and noticing details. Drives learning and figuring things out.',
      low: ['Slow to catch on', 'Forgets details', 'Prefers to be told what to do'],
      mid: ['Practical thinker', 'Good memory for faces', 'Learns by doing'],
      high: ['Sharp-eyed, misses little', 'Photographic memory', 'Reads three books a week', 'Solves puzzles for fun'] },
    POW: { name: 'Power', what: 'Willpower and inner strength. Sets Willpower Points and starting Sanity (POW×5).',
      low: ['Easily rattled', 'Gives in under pressure', 'Nervous, fidgety'],
      mid: ['Even-keeled under pressure', 'Stubborn when it counts', 'Hard to read'],
      high: ['Unshakeable calm', 'Iron will', 'Stares people down', 'Strangely lucky'] },
    CHA: { name: 'Charisma', what: 'Charm, presence and how people respond. Every Bond starts at this score.',
      low: ['Awkward with strangers', 'Blunt to the point of rude', 'Forgettable'],
      mid: ['Easy to talk to', 'Pleasant, unremarkable', 'Good listener'],
      high: ['Magnetic presence', 'Silver tongue', 'Everyone remembers them', 'Natural leader'] }
  };
  function suggestFeature(stat, score, avoid) {
    var i = STAT_INFO[stat]; if (!i) return '';
    var band = score <= 8 ? i.low : score >= 13 ? i.high : i.mid;
    var pool = band.filter(function (f) { return f !== avoid; });
    return pool[Math.floor(Math.random() * pool.length)] || band[0];
  }

  /* ── Profession families: the Handbook's (from stats/professions.js) and
     The Complex's own, with their professional skills and Bonds ── */
  function S(name, value) { return { name: name, value: value }; }
  var COMPLEX = [
    { key: 'cbp_marine', agency: 'Customs & Border Protection', employer: 'CBP Air and Marine Operations', title: 'Marine Interdiction Agent', bonds: 2,
      blurb: 'Boards smugglers\' boats from fast interceptors on the coasts and rivers.',
      skills: [S('Alertness', 50), S('Bureaucracy', 30), S('Criminology', 50), S('Drive', 50), S('Firearms', 50), S('Forensics', 30), S('Foreign Language (Spanish)', 50), S('Heavy Weapons', 30), S('HUMINT', 60), S('Law', 30), S('Persuade', 40), S('Pilot (Boat)', 60), S('Search', 50), S('Swim', 50), S('Unarmed Combat', 60)],
      bonus: ['Alertness', 'Athletics', 'Search', 'SIGINT'], kit: { base: 'federal_agent', add: ['Water survival gear (life vest, dry bag, flares)'] } },
    { key: 'cbp_bortac', agency: 'Customs & Border Protection', employer: 'CBP Border Patrol (BORTAC)', title: 'Border Tactical Unit Operator', bonds: 2,
      blurb: 'Border Patrol\'s tactical team: remote terrain, days without resupply.',
      skills: [S('Alertness', 50), S('Bureaucracy', 20), S('Criminology', 50), S('Drive', 50), S('Firearms', 50), S('Forensics', 30), S('Foreign Language (Spanish)', 40), S('HUMINT', 40), S('Law', 30), S('Navigate', 60), S('Persuade', 50), S('Pharmacy', 50), S('Search', 50), S('Survival', 60), S('Unarmed Combat', 60)],
      bonus: ['Alertness', 'Firearms', 'Melee Weapons', 'Military Science (Land)'], kit: { base: 'federal_agent', add: ['Extended camping gear', 'Handheld GPS'] } },
    { key: 'cbp_borstar', agency: 'Customs & Border Protection', employer: 'CBP Border Patrol (BORSTAR)', title: 'Search, Trauma & Rescue Agent', bonds: 2,
      blurb: 'Medic and searcher for the Border Patrol\'s remote operations.',
      skills: [S('Bureaucracy', 50), S('First Aid', 60), S('Forensics', 50), S('Medicine', 60), S('Navigate', 40), S('Persuade', 40), S('Pharmacy', 50), S('Science (Biology)', 50), S('Search', 50), S('Surgery', 50), S('Survival', 30)],
      bonus: ['Firearms', 'First Aid', 'Medicine', 'Survival'], kit: { base: 'federal_agent', add: ['First responder medical kit', 'Trauma kit and splints'] } },
    { key: 'atf_medic', agency: 'ATF', employer: 'ATF Special Response Team', title: 'Tactical Medic', bonds: 1,
      blurb: 'A special agent trained to treat gunshot trauma in the middle of a raid.',
      skills: [S('Alertness', 50), S('Bureaucracy', 40), S('Criminology', 50), S('Drive', 50), S('Firearms', 50), S('First Aid', 50), S('Forensics', 30), S('HUMINT', 60), S('Law', 30), S('Medicine', 30), S('Military Science (Land)', 30), S('Persuade', 50), S('Pharmacy', 50), S('Search', 50), S('Unarmed Combat', 60)],
      bonus: ['Firearms', 'First Aid', 'Science (Biology)', 'Surgery'], kit: { base: 'federal_agent', add: ['First responder medical kit', 'Tourniquets and hemostatic gauze'] } },
    { key: 'atf_tactical', agency: 'ATF', employer: 'ATF Special Response Team', title: 'Tactical Operator', bonds: 1,
      blurb: 'Hunts the most dangerous fugitives with the ATF\'s response teams.',
      skills: [S('Alertness', 60), S('Athletics', 60), S('Demolitions', 50), S('Dodge', 60), S('Firearms', 60), S('First Aid', 40), S('Heavy Weapons', 50), S('Melee Weapons', 50), S('Military Science (Land)', 30), S('Navigate', 50), S('Stealth', 60), S('Survival', 50), S('Swim', 50), S('Unarmed Combat', 60)],
      bonus: ['Athletics', 'Demolitions', 'Firearms', 'HUMINT'], kit: { base: 'swat' } },
    { key: 'atf_analyst', agency: 'ATF', employer: 'ATF', title: 'Criminal Investigative Analyst', bonds: 3,
      blurb: 'Behavioral and geographic profiler: where the offender lives, what they do next.',
      skills: [S('Bureaucracy', 40), S('Computer Science', 40), S('Criminology', 50), S('Foreign Language (Spanish)', 40), S('HUMINT', 60), S('Forensics', 40), S('Law', 40), S('Psychotherapy', 30), S('Science (Statistics)', 50), S('Science (Biology)', 50)],
      bonus: ['Criminology', 'Forensics', 'Law', 'Psychotherapy'], kit: { items: ['Agency badge and ID', 'Powerful computer', 'Advanced data-analysis software', 'Tablet computer or smartphone', 'Access to FBI and ATF case databases', 'Library on criminal behavior'] } },
    { key: 'atf_explosives', agency: 'ATF', employer: 'ATF', title: 'Explosives Specialist', bonds: 1,
      blurb: 'Investigates bombings and makes live devices safe.',
      skills: [S('Alertness', 60), S('Athletics', 60), S('Artillery', 40), S('Demolitions', 60), S('Dodge', 60), S('Firearms', 50), S('First Aid', 40), S('Heavy Machinery', 60), S('Heavy Weapons', 50), S('Military Science (Land)', 20), S('Stealth', 50), S('Survival', 50), S('Swim', 50), S('Unarmed Combat', 50)],
      bonus: ['Criminology', 'Demolitions', 'Forensics', 'Science (Chemistry)'], kit: { base: 'federal_agent', add: ['?Bomb suit', 'Explosives toolkit', 'Electronic and chemical test kit', 'Bomb-disposal robot (on request)'] } },
    { key: 'usss_ppd', agency: 'Secret Service', employer: 'U.S. Secret Service', title: 'Protective Detail Agent', bonds: 1,
      blurb: 'Bodyguard for the most high-profile people in the country.',
      skills: [S('Alertness', 60), S('Athletics', 50), S('Criminology', 30), S('Demolitions', 40), S('Drive', 50), S('Firearms', 60), S('Heavy Weapons', 50), S('HUMINT', 60), S('Law', 20), S('Melee Weapons', 50), S('Navigate', 50), S('Stealth', 50), S('Survival', 50), S('Swim', 50), S('Unarmed Combat', 60)],
      bonus: ['Athletics', 'First Aid', 'Military Science (Land)', 'Search'], kit: { base: 'federal_agent', add: ['Earpiece communication set', 'Dark suit cut for a holster'] } },
    { key: 'usss_cat', agency: 'Secret Service', employer: 'U.S. Secret Service', title: 'Counter Assault Team Operator', bonds: 1,
      blurb: 'Suppresses an attack so the protectee can be pulled out.',
      skills: [S('Alertness', 60), S('Athletics', 60), S('Demolitions', 40), S('Drive', 50), S('Firearms', 60), S('First Aid', 40), S('Heavy Weapons', 50), S('Melee Weapons', 50), S('Military Science (Land)', 60), S('Navigate', 50), S('Stealth', 50), S('Survival', 50), S('Swim', 50), S('Unarmed Combat', 60)],
      bonus: ['Alertness', 'Criminology', 'Firearms', 'Law'], kit: { base: 'swat' } },
    { key: 'uscg_sar', agency: 'Coast Guard', employer: 'U.S. Coast Guard', title: 'Search and Rescue Swimmer', bonds: 2,
      blurb: 'Goes into the worst water and weather to bring people back.',
      skills: [S('Alertness', 60), S('Athletics', 60), S('Craft (Electrician)', 40), S('Craft (Mechanic)', 40), S('First Aid', 50), S('Foreign Language (Spanish)', 20), S('HUMINT', 40), S('Navigate', 50), S('Pilot (Small Boat)', 50), S('Pilot (Helicopter)', 30), S('Science (Meteorology)', 50), S('Swim', 60)],
      bonus: ['Alertness', 'First Aid', 'Navigate', 'Swim'], kit: { items: ['Coast Guard ID', 'Thermal wetsuit and fins', 'Water survival gear (life vest, strobe, flares)', 'Rescue harness and line', 'Individual first aid kit', 'Short-range walkie talkie or early-generation mobile phone'] } },
    { key: 'uscg_hitron', agency: 'Coast Guard', employer: 'U.S. Coast Guard (HITRON)', title: 'Helicopter Interdiction Sniper', bonds: 2,
      blurb: 'Disables smugglers\' engines with precision fire from a helicopter.',
      skills: [S('Alertness', 60), S('Athletics', 40), S('Bureaucracy', 30), S('Craft (Electrician)', 50), S('Craft (Mechanic)', 50), S('Firearms', 60), S('Heavy Machinery', 40), S('Military Science (Sea)', 50), S('Navigate', 50), S('Pilot (Helicopter)', 50), S('Science (Meteorology)', 40), S('Swim', 50)],
      bonus: ['Alertness', 'Craft (Mechanic)', 'Firearms', 'Pilot (Helicopter)'], kit: { base: 'special_operator', add: ['Very heavy rifle', 'Telescopic sight'] } },
    { key: 'uscg_taclet', agency: 'Coast Guard', employer: 'U.S. Coast Guard (TACLET)', title: 'Tactical Law Enforcement Team Member', bonds: 2,
      blurb: 'Rides Navy ships to board narcotics runners and pirates.',
      skills: [S('Alertness', 50), S('Athletics', 40), S('Bureaucracy', 40), S('Criminology', 50), S('Drive', 50), S('Firearms', 50), S('Foreign Language (Spanish)', 50), S('Forensics', 30), S('Heavy Weapons', 50), S('HUMINT', 60), S('Law', 30), S('Persuade', 50), S('Search', 50), S('Swim', 60), S('Unarmed Combat', 60)],
      bonus: ['Alertness', 'Firearms', 'Military Science (Sea)', 'Pilot (Boat)'], kit: { base: 'federal_agent', add: ['Water survival gear (life vest, strobe, flares)'] } },
    { key: 'uscg_msst', agency: 'Coast Guard', employer: 'U.S. Coast Guard (MSST)', title: 'Maritime Safety & Security Team Member', bonds: 1,
      blurb: 'Patrols the big ports in armed boats against national-security threats.',
      skills: [S('Alertness', 60), S('Athletics', 50), S('Bureaucracy', 30), S('Craft (Mechanic)', 40), S('Criminology', 40), S('Firearms', 40), S('Heavy Weapons', 50), S('Law', 40), S('Military Science (Sea)', 50), S('Navigate', 50), S('Pilot (Small Boat)', 60), S('Science (Meteorology)', 40), S('Search', 30), S('Swim', 60)],
      bonus: ['Alertness', 'Forensics', 'HUMINT', 'Stealth'], kit: { base: 'federal_agent', add: ['Water survival gear (life vest, strobe, flares)'] } },
    { key: 'uscg_msrt', agency: 'Coast Guard', employer: 'U.S. Coast Guard (MSRT)', title: 'Maritime Security Response Operator', bonds: 1,
      blurb: 'The Coast Guard\'s waterborne SWAT: retakes ships from hijackers.',
      skills: [S('Alertness', 60), S('Athletics', 60), S('Demolitions', 40), S('Dodge', 60), S('Firearms', 60), S('Heavy Weapons', 50), S('Melee Weapons', 50), S('Military Science (Sea)', 60), S('Navigate', 50), S('Search', 40), S('Stealth', 50), S('Survival', 50), S('Swim', 50), S('Unarmed Combat', 60)],
      bonus: ['Alertness', 'Athletics', 'Firearms', 'Law'], kit: { base: 'special_operator', add: ['Handcuffs'] } },
    { key: 'nsa_crypto', agency: 'NSA', employer: 'National Security Agency', title: 'Cryptanalyst', bonds: 3,
      blurb: 'Writes the mathematics that breaks foreign encryption.',
      skills: [S('Accounting', 50), S('Bureaucracy', 40), S('Computer Science', 60), S('Craft (Microelectronics)', 60), S('Criminology', 50), S('Foreign Language (Russian)', 40), S('Science (Physics)', 60), S('Science (Mathematics)', 60), S('SIGINT', 60)],
      bonus: ['Computer Science', 'Craft (Microelectronics)', 'Science (Mathematics)', 'SIGINT'], kit: { items: ['Agency badge and clearance', 'Powerful computer', 'Cutting-edge encryption or data-mining software', 'Library of math and computing journals'] } },
    { key: 'nsa_tao', agency: 'NSA', employer: 'National Security Agency (TAO)', title: 'Tailored Access Operations Hacker', bonds: 2,
      blurb: 'Breaks into foreign networks for cyber-espionage.',
      skills: [S('Accounting', 50), S('Bureaucracy', 50), S('Computer Science', 60), S('Craft (Electrician)', 30), S('Craft (Mechanic)', 30), S('Craft (Microelectronics)', 50), S('Criminology', 60), S('Foreign Language (Chinese)', 60), S('HUMINT', 50), S('Science (Mathematics)', 40), S('SIGINT', 60)],
      bonus: ['Bureaucracy', 'Computer Science', 'Foreign Language', 'SIGINT'], kit: { items: ['Agency badge and clearance', 'Powerful computer', 'Cutting-edge encryption or data-mining software', 'Portable IMSI catcher for cell surveillance', 'Library of classified hacking analyses'] } },
    { key: 'nsa_remote', agency: 'NSA', employer: 'National Security Agency', title: 'Remote Device Technician', bonds: 2,
      blurb: 'Plants clandestine surveillance gear and comes back for what it caught.',
      skills: [S('Alertness', 50), S('Craft (Electrician)', 40), S('Craft (Locksmith)', 60), S('Criminology', 50), S('Disguise', 50), S('Dodge', 40), S('Drive', 50), S('Firearms', 40), S('Law', 40), S('Melee Weapons', 40), S('Persuade', 50), S('Search', 60), S('Stealth', 60), S('Unarmed Combat', 50)],
      bonus: ['Craft (Mechanic)', 'Craft (Microelectronics)', 'Science (Physics)', 'Search'], kit: { items: ['Lockpick kit', 'Fiber optic scope', 'Bug detector', 'GPS tracking device', 'Voice-activated recorder', 'Disguise kit', 'Technical manuals for common devices'] } },
    { key: 'nps_interpretive', agency: 'National Park Service', employer: 'National Park Service', title: 'Interpretive Ranger', bonds: 2,
      blurb: 'Teaches visitors about the park and keeps an eye on it.',
      skills: [S('Bureaucracy', 50), S('First Aid', 60), S('Forensics', 50), S('History', 60), S('HUMINT', 60), S('Navigate', 40), S('Persuade', 60), S('Science (Ecology)', 60), S('Search', 50), S('Survival', 60)],
      bonus: ['Firearms', 'First Aid', 'Medicine', 'Survival'], kit: { items: ['Ranger uniform and badge', 'Basic camping gear', 'Individual first aid kit', 'Handheld GPS', 'Ordinary binoculars', 'Field guides to the park\'s history and wildlife'] } },
    { key: 'nasa_astronaut', agency: 'NASA', employer: 'NASA', title: 'Astronaut', bonds: 2,
      blurb: 'One of the very few certified to fly spacecraft.',
      skills: [S('Alertness', 60), S('Athletics', 50), S('Bureaucracy', 30), S('Craft (Electrician)', 40), S('Craft (Mechanic)', 40), S('Military Science (Air)', 30), S('Navigate', 50), S('Pilot (Airplane)', 60), S('Pilot (Spacecraft)', 60), S('Science (Meteorology)', 40), S('Science (Physics)', 40), S('Swim', 40)],
      bonus: ['Heavy Machinery', 'Science (Biology)', 'Science (Mathematics)', 'Science (Meteorology)'], kit: { items: ['NASA credentials', 'Flight suit', 'Pilot\'s license and logbook', 'Tablet computer or smartphone', 'Access to launch and training facilities'] } },
    { key: 'contractor_targeting', agency: 'Contractors (CACI / Booz Allen)', employer: 'CACI International', title: 'Targeting Officer', bonds: 3,
      blurb: 'Maps the people and money behind arms, drug and terror networks.',
      skills: [S('Accounting', 50), S('Anthropology', 60), S('Bureaucracy', 40), S('Computer Science', 40), S('Criminology', 50), S('Foreign Language (Arabic)', 50), S('Forensics', 30), S('HUMINT', 60), S('History', 60), S('SIGINT', 60)],
      bonus: ['Bureaucracy', 'History', 'Law', 'Search'], kit: { items: ['Contractor badge and clearance', 'Powerful computer', 'Advanced data-analysis software', 'Access to classified analyses and surveillance data'] } }
  ];

  /* ── Agency postings: an existing profession in an agency's job, with
     its employer, suggested bonus skills and kit ── */
  function P(agency, title, prof, employer, bonus, kitAdd) { return { agency: agency, title: title, profession: prof, employer: employer, bonus: bonus, kitAdd: kitAdd || [] }; }
  var POSTINGS = [
    P('Customs & Border Protection', 'Port of Entry Officer', 'federal_agent', 'CBP Office of Field Operations', ['Alertness', 'Bureaucracy', 'HUMINT', 'Persuade']),
    P('Customs & Border Protection', 'Canine Handler', 'federal_agent', 'CBP Office of Field Operations', ['Alertness', 'Craft (Dog Training)', 'Science (Veterinary Science)', 'Search'], ['A working dog', 'Dog-handling gear and veterinary kit']),
    P('Customs & Border Protection', 'Border Patrol Agent', 'federal_agent', 'U.S. Border Patrol', ['Athletics', 'Drive', 'Navigate', 'Survival'], ['Extended camping gear']),
    P('Customs & Border Protection', 'Air Security Pilot', 'pilot_sailor', 'CBP Air and Marine Operations', ['Alertness', 'SIGINT', 'Pilot (Drone)', 'Craft (Electronics)'], ['Access to a patrol aircraft or drone station']),
    P('ATF', 'Canine Handler', 'federal_agent', 'ATF Special Response Team', ['Craft (Dog Training)', 'Melee Weapons', 'Search', 'Survival'], ['A working dog', 'Dog-handling gear']),
    P('ATF', 'Field Special Agent', 'federal_agent', 'ATF Office of Field Operations', ['Criminology', 'Forensics', 'Firearms', 'Law']),
    P('Secret Service', 'Protective Intelligence Analyst', 'intelligence_analyst', 'U.S. Secret Service', ['Computer Science', 'Criminology', 'HUMINT', 'SIGINT']),
    P('Secret Service', 'Financial Crimes Specialist', 'lawyer_executive', 'U.S. Secret Service', ['Accounting', 'Computer Science', 'Criminology', 'SIGINT']),
    P('Coast Guard', 'Response Policy Officer', 'program_manager', 'U.S. Coast Guard', ['Accounting', 'Bureaucracy', 'Persuade', 'Military Science (Sea)']),
    P('Coast Guard', 'Casualty Investigator', 'anthropologist', 'U.S. Coast Guard', ['Craft (Mechanic)', 'Forensics', 'HUMINT', 'Search']),
    P('Coast Guard', 'National Strike Force Scientist', 'scientist', 'U.S. Coast Guard', ['Bureaucracy', 'Science (Chemistry)', 'Science (Environmental)', 'Science (Meteorology)'], ['HAZMAT suit', 'Gas mask']),
    P('Counterterrorism Center (NCTC)', 'Joint Assessment Team Member', 'intelligence_analyst', 'National Counterterrorism Center', ['Bureaucracy', 'Foreign Language', 'HUMINT', 'Law']),
    P('Counterterrorism Center (NCTC)', 'Interagency Coordinator', 'federal_agent', 'National Counterterrorism Center', ['Bureaucracy', 'Criminology', 'Foreign Language', 'HUMINT']),
    P('Counterterrorism Center (NCTC)', 'Near East Desk Analyst', 'intelligence_analyst', 'National Counterterrorism Center', ['Bureaucracy', 'Criminology', 'Foreign Language (Arabic)', 'History']),
    P('Naval Intelligence (ONI)', 'Foreign Naval Analyst', 'computer_scientist', 'Office of Naval Intelligence', ['Computer Science', 'Craft (Mechanic)', 'Science (Physics)', 'Military Science (Sea)']),
    P('Naval Intelligence (ONI)', 'Maritime Domain Analyst', 'intelligence_analyst', 'Office of Naval Intelligence', ['Alertness', 'Foreign Language (Chinese)', 'Military Science (Sea)', 'Search']),
    P('NSA', 'Counterintelligence Investigator', 'federal_agent', 'National Security Agency', ['Computer Science', 'Foreign Language', 'SIGINT', 'Stealth']),
    P('Defense Intelligence (DIA)', 'Clandestine Service Officer', 'intelligence_case_officer', 'Defense Intelligence Agency', ['Bureaucracy', 'Foreign Language', 'HUMINT', 'Military Science (Land)']),
    P('Defense Intelligence (DIA)', 'Americas Division Analyst', 'intelligence_analyst', 'Defense Intelligence Agency', ['History', 'Foreign Language (Spanish)', 'HUMINT', 'Military Science (Land)']),
    P('Defense Intelligence (DIA)', 'Defense Attaché', 'soldier_marine', 'Defense Intelligence Agency', ['Bureaucracy', 'Foreign Language', 'HUMINT', 'Law'], ['Diplomatic credentials', 'Embassy access']),
    P('Geospatial-Intelligence (NGA)', 'InnoVision Researcher', 'scientist', 'National Geospatial-Intelligence Agency', ['Bureaucracy', 'Craft (Engineering)', 'SIGINT', 'Science (Chemistry)']),
    P('Geospatial-Intelligence (NGA)', 'Imagery Analyst', 'intelligence_analyst', 'National Geospatial-Intelligence Agency', ['Accounting', 'Bureaucracy', 'SIGINT', 'Science (Mathematics)']),
    P('Reconnaissance Office (NRO)', 'Imagery Systems Analyst', 'intelligence_analyst', 'National Reconnaissance Office', ['Art (Mapmaking)', 'Computer Science', 'Science (Engineering)', 'SIGINT']),
    P('Reconnaissance Office (NRO)', 'Advanced Systems Scientist', 'scientist', 'National Reconnaissance Office', ['Art (Graphic Design)', 'Bureaucracy', 'Computer Science', 'Science (Physics)']),
    P('National Park Service', 'Park Ranger', 'police_officer', 'National Park Service', ['Athletics', 'Navigate', 'Science (Ecology)', 'Survival'], ['Basic camping gear']),
    P('National Park Service', 'Protection Ranger (ISB)', 'federal_agent', 'National Park Service', ['Athletics', 'Navigate', 'Stealth', 'Survival'], ['Extended camping gear']),
    P('National Park Service', 'Park Biologist', 'scientist', 'National Park Service', ['History', 'Law', 'Search', 'Survival'], ['Basic camping gear']),
    P('National Park Service', 'Wildland Firefighter', 'firefighter', 'National Park Service', ['Athletics', 'First Aid', 'Survival', 'Swim'], ['Extended camping gear', 'Emergency fire shelter']),
    P('National Park Service', 'Federal Archeologist', 'anthropologist', 'National Park Service', ['Archeology', 'Navigate', 'Search', 'Survival'], ['Basic camping gear']),
    P('FEMA', 'Urban Search and Rescue', 'firefighter', 'FEMA Urban Search and Rescue', ['Alertness', 'First Aid', 'Search', 'Survival']),
    P('FEMA', 'Mitigation Program Manager', 'program_manager', 'FEMA', ['Bureaucracy', 'Craft (Architect)', 'Science (Meteorology)', 'Survival']),
    P('FEMA', 'Disaster Medical Responder', 'nurse_paramedic', 'FEMA National Disaster Medical System', ['First Aid', 'HUMINT', 'Psychotherapy', 'Survival'], ['Extended camping gear']),
    P('NASA', 'Kennedy Emergency Response Team', 'special_operator', 'NASA Kennedy Space Center', ['Athletics', 'Alertness', 'Dodge', 'Firearms']),
    P('NASA', 'Space Communications Scientist', 'scientist', 'NASA', ['Bureaucracy', 'Computer Science', 'Science (Astronomy)', 'SIGINT']),
    P('NASA', 'Flight Research Engineer', 'scientist', 'NASA Armstrong Flight Research Center', ['Bureaucracy', 'Craft (Engineer)', 'Craft (Mechanic)', 'Science (Aeronautics)']),
    P('NASA', 'Orion Program Manager', 'program_manager', 'NASA', ['Accounting', 'Bureaucracy', 'Craft (Engineering)', 'Science (Physics)']),
    P('DARPA', 'Tactical Technology Program Manager', 'program_manager', 'DARPA', ['Accounting', 'Bureaucracy', 'Science (Engineering)', 'Science (Physics)'], ['One impractical, buggy prototype']),
    P('DARPA', 'Microsystems Program Manager', 'program_manager', 'DARPA', ['Bureaucracy', 'Computer Science', 'Science (Mathematics)', 'Science (Physics)'], ['One fragile piece of concept machinery']),
    P('DARPA', 'Technology Contractor', 'computer_scientist', 'DARPA (contractor)', ['Bureaucracy', 'Computer Science', 'Craft (Microelectronics)', 'Science (Physics)']),
    P('Nuclear Security (NNSA)', 'Secure Transportation Courier', 'special_operator', 'NNSA Office of Secure Transportation', ['Alertness', 'Drive', 'HUMINT', 'Law'], ['Personal protection equipment (PPE)', 'Access to hardened vehicles']),
    P('Nuclear Security (NNSA)', 'NEST Search Scientist', 'scientist', 'NNSA Nuclear Emergency Support Team', ['Alertness', 'Computer Science', 'Science (Physics)', 'SIGINT'], ['HAZMAT suit', 'Radiation detectors']),
    P('Nuclear Security (NNSA)', 'NEST Technical Operator', 'firefighter', 'NNSA Nuclear Emergency Support Team', ['Alertness', 'Craft (Electronics)', 'Demolitions', 'Science (Nuclear Physics)'], ['Bomb suit', 'Remote-controlled robot']),
    P('IRS', 'Criminal Investigation Agent', 'federal_agent', 'IRS Criminal Investigation', ['Accounting', 'Computer Science', 'Science (Mathematics)', 'SIGINT']),
    P('IRS', 'Professional Responsibility Attorney', 'lawyer_executive', 'IRS Office of Professional Responsibility', ['Accounting', 'Computer Science', 'Forensics', 'Law']),
    P('Constellis', 'Mobile Security Team', 'special_operator', 'Constellis', ['Computer Science', 'HUMINT', 'Persuade', 'Search']),
    P('Constellis', 'Tactical Roleplayer', 'soldier_marine', 'Constellis', ['Disguise', 'HUMINT', 'Persuade', 'Stealth']),
    P('Constellis', 'Designated Marksman', 'special_operator', 'Constellis', ['Alertness', 'Craft (Gunsmith)', 'Firearms', 'Search'], ['Heavy rifle', 'Telescopic sight']),
    P('Constellis', 'Protective Security Specialist', 'police_officer', 'Constellis', ['Alertness', 'First Aid', 'Foreign Language', 'Stealth']),
    P('Constellis', 'Security Paramedic', 'nurse_paramedic', 'Constellis', ['Firearms', 'Melee Weapons', 'Search', 'Unarmed Combat'], ['First responder medical kit']),
    P('Constellis', 'Socio-Cultural Analyst', 'media_specialist', 'Constellis', ['Bureaucracy', 'Computer Science', 'Foreign Language', 'Law']),
    P('Lockheed Martin', 'Robotics Research Scientist', 'computer_scientist', 'Lockheed Martin', ['Anthropology', 'Science (Biology)', 'Science (Logic)', 'Science (Physics)']),
    P('Lockheed Martin', 'Advanced Programs Engineer', 'computer_scientist', 'Lockheed Martin Skunk Works', ['Heavy Machinery', 'Military Science (Air)', 'Pilot (Airplane)', 'Science (Engineering)']),
    P('Lockheed Martin', 'Test Pilot', 'pilot_sailor', 'Lockheed Martin Skunk Works', ['Computer Science', 'Heavy Machinery', 'Pilot (Airplane)', 'Science (Physics)']),
    P('Lockheed Martin', 'Systems Risk Analyst', 'program_manager', 'Lockheed Martin', ['Alertness', 'Criminology', 'SIGINT', 'Stealth']),
    P('Lockheed Martin', 'Space Operations Controller', 'computer_scientist', 'Lockheed Martin', ['Navigate', 'Science (Astrophysics)', 'Science (Mathematics)', 'Science (Statistics)']),
    P('Contractors (CACI / Booz Allen)', 'Signals Analyst', 'computer_scientist', 'Booz Allen Hamilton', ['Art (Writing)', 'Bureaucracy', 'Foreign Language', 'HUMINT']),
    P('Contractors (CACI / Booz Allen)', 'Digital Forensics Analyst', 'computer_scientist', 'Booz Allen Hamilton', ['Accounting', 'Forensics', 'HUMINT', 'Science (Statistics)']),
    P('Contractors (CACI / Booz Allen)', 'Counterintelligence Interrogator', 'foreign_service', 'CACI International', ['Firearms', 'HUMINT', 'Persuade', 'Pharmacy']),
    P('RAND Corporation', 'Army Fellow Analyst', 'intelligence_analyst', 'RAND Corporation', ['Bureaucracy', 'Military Science (Land)', 'Navigate', 'Science (Ballistics)']),
    P('RAND Corporation', 'Drug Policy Researcher', 'scientist', 'RAND Corporation', ['Criminology', 'Law', 'Science (Mathematics)', 'Pharmacy']),
    P('RAND Corporation', 'Project AIR FORCE Researcher', 'scientist', 'RAND Corporation', ['Bureaucracy', 'Craft (Mechanic)', 'Military Science (Air)', 'SIGINT']),
    P('RAND Corporation', 'Theoretical Mathematician', 'scientist', 'RAND Corporation', ['Bureaucracy', 'History', 'Science (Systems Theory)', 'Science (Quantum Theory)'])
  ];

  /* ── Starting kits: the Agent's Handbook's Tools of the Trade where it
     has them, real-world kit for the rest. A name that matches the
     equipment catalog (stats/equipment-data.js) carries its numbers; a
     leading '?' means offered but not ticked. ── */
  var KITS = {
    federal_agent: ['Agency badge and ID', 'Medium pistol', 'Two spare magazines', 'Tactical light or weapon light', 'Handcuffs', 'Kevlar vest', 'Agency windbreaker', 'Tablet computer or smartphone', 'Earpiece communication set', 'Evidence-collection kit',
      '?Light pistol', '?Light rifle or carbine', '?Holographic sight', '?Tactical body armor', '?Kevlar helmet', '?Individual first aid kit', '?Small fire extinguisher (CO2)'],
    swat: ['Agency badge and ID', 'Light rifle or carbine', 'Targeting laser', 'Tactical light or weapon light', 'Shotgun (firing slug)', 'Medium pistol', 'Knife', 'Flash-bang grenade, thrown', 'Tear gas grenade, thrown', 'CED pistol', 'Pepper spray can',
      'Halligan forcible-entry tool', 'Earpiece communication set', 'Flexible cuffs', 'Tactical body armor', 'Kevlar helmet', 'Gas mask', 'Ordinary binoculars', 'Large flashlight', '?Ballistic shield'],
    special_operator: ['Dog tags', 'Light rifle or carbine', 'Holographic sight', 'Targeting laser', 'Sound suppressor', 'Medium pistol', 'Hand grenade', 'Flash-bang grenade, thrown', 'Long knife or combat dagger', 'Flexible cuffs',
      'Tactical body armor', 'Kevlar helmet', 'Tactical light or weapon light', 'Military-grade night vision goggles', 'Earpiece communication set', 'Individual first aid kit', 'Handheld GPS'],
    police_officer: ['Badge and ID', 'Reinforced Kevlar vest', 'Medium pistol', 'Two spare magazines', 'Pepper spray can', 'CED pistol', 'Club, nightstick, baton, or collapsible baton', 'Knife', 'Handcuffs', 'Large flashlight', 'Short-range walkie talkie or early-generation mobile phone', 'Pocket notebook',
      '?Light pistol', '?Light rifle or carbine', '?Shotgun (firing shot)', '?Riot helmet', '?Individual first aid kit'],
    anthropologist: ['University or museum ID', 'Field notebooks', 'Tablet computer or smartphone', 'Ordinary computer', 'Digital camera', 'Voice-activated recorder', 'Reference library in their field', '?Basic camping gear', '?Handheld GPS', '?Individual first aid kit'],
    computer_scientist: ['Company or lab ID', 'Powerful computer', 'Tablet computer or smartphone', 'Toolkit (multimeter, soldering iron, drivers)', 'Cables, adapters and USB drives', '?Advanced data-analysis software', '?"Script kiddie" hacking software'],
    criminal: ['Fake ID', 'Burner phone', 'Medium pistol', 'Knife', 'Lockpick kit', 'Roll of cash', '?Brass knuckles, heavy flashlight, or steel-toe boots', '?Light pistol'],
    firefighter: ['Fire department ID', 'Personal protection equipment (PPE)', 'Gas mask', 'Halligan forcible-entry tool', 'Hatchet', 'Large flashlight', 'Short-range walkie talkie or early-generation mobile phone', 'First responder medical kit', '?Heavy-duty fire extinguisher', '?HAZMAT suit'],
    foreign_service: ['Diplomatic passport and credentials', 'Tablet computer or smartphone', 'Ordinary computer', 'Embassy access card', '?Satellite phone', '?Burner phone'],
    intelligence_analyst: ['Agency badge and clearance', 'Powerful computer', 'Advanced data-analysis software', 'Tablet computer or smartphone', 'Access to classified reporting'],
    intelligence_case_officer: ['Cover identity documents', 'Burner phone', 'Tablet computer or smartphone', 'Voice-activated recorder', 'Cash in local currency', '?Light pistol', '?Lockpick kit', '?Bug detector'],
    lawyer_executive: ['Bar card or company ID', 'Tablet computer or smartphone', 'Ordinary computer', 'Briefcase with case files', 'Voice-activated recorder'],
    media_specialist: ['Press credentials', 'Digital camera', 'Tablet computer or smartphone', 'Ordinary computer', 'Voice-activated recorder', '?Basic, open-market drone'],
    nurse_paramedic: ['Hospital or agency ID', 'First responder medical kit', 'Individual first aid kit', 'Stethoscope and blood-pressure cuff', 'Tablet computer or smartphone', '?Personal protection equipment (PPE)'],
    physician: ['Hospital credentials', 'Medical bag', 'First responder medical kit', 'Prescription pad', 'Tablet computer or smartphone'],
    pilot_sailor: ['Pilot\'s license or captain\'s papers', 'Flight bag or chart case', 'Handheld GPS', 'Short-range walkie talkie or early-generation mobile phone', 'Individual first aid kit', '?Ordinary binoculars'],
    program_manager: ['Agency or company ID and clearance', 'Tablet computer or smartphone', 'Ordinary computer', 'Authority over a project budget'],
    scientist: ['Lab or university ID', 'Powerful computer', 'Tablet computer or smartphone', 'Field sampling kit', '?Personal protection equipment (PPE)', '?Gas mask'],
    soldier_marine: ['Military ID and dog tags', 'Light rifle or carbine', 'Tactical body armor', 'Kevlar helmet', 'Knife', 'Individual first aid kit', 'Short-range walkie talkie or early-generation mobile phone', '?Medium pistol', '?Hand grenade', '?Ordinary binoculars'],
    new_profession: []
  };
  function kitFor(key, posting) {
    var c = COMPLEX.filter(function (p) { return p.key === key; })[0];
    var items;
    if (c) items = c.kit.items ? c.kit.items.slice() : (KITS[c.kit.base] || []).concat(c.kit.add || []);
    else items = (KITS[key] || []).slice();
    if (posting && posting.kitAdd) items = items.concat(posting.kitAdd);
    var seen = {};
    return items.filter(function (n) { var k = n.replace(/^\?/, ''); if (seen[k]) return false; seen[k] = 1; return true; })
      .map(function (n) { return { name: n.replace(/^\?/, ''), on: n.charAt(0) !== '?' }; });
  }

  /* ── Bond lists (stats/bonds.js), regrouped ── */
  var FAMILY_RE = /^(older |younger )?(brother|sister|wife|husband|uncle|aunt|daughter|son|mother|father|grand\w*|cousin|nephew|niece|partner|god\w*)\b/i;
  var BOND_CATS = [['family', 'Family'], ['friends', 'Friends'], ['delta_green', 'Delta Green'], ['other_gov', 'Other Governments'], ['underworld', 'Underworld']];
  function bondList(cat) {
    var B = typeof bonds !== 'undefined' ? bonds : window.bonds; // eslint-disable-line no-undef
    if (!B) return [];
    if (cat === 'family') return (B.FRIENDS_FAMILY || []).filter(function (b) { return FAMILY_RE.test(b.relationship || ''); });
    if (cat === 'friends') return (B.FRIENDS_FAMILY || []).filter(function (b) { return !FAMILY_RE.test(b.relationship || ''); });
    if (cat === 'delta_green') return B.DELTA_GREEN || [];
    if (cat === 'other_gov') return B.PISCES_UK || [];
    if (cat === 'underworld') return B.UNDERWORLD || [];
    return [];
  }
  function randomBond(cats, avoid) {
    var pool = [];
    (cats && cats.length ? cats : BOND_CATS.map(function (c) { return c[0]; })).forEach(function (c) { pool = pool.concat(bondList(c)); });
    pool = pool.filter(function (b) { return (avoid || []).indexOf(b.name) === -1; });
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  /* ── Bonus skill packages (the old sheet's, stats/scripts.js): skill
     keys, a '?kind' choose-slot, or a specialty written out ── */
  var BONUS_PACKAGES = [
      {
          label: 'Artist, Actor, or Musician',
          skills: ['alertness', '?craft', 'disguise', 'persuade', '?art', '?art', '?art', 'humint'],
          desc: 'Alertness \u00b7 Craft (choose one) \u00b7 Disguise \u00b7 Persuade \u00b7 Art (choose one) \u00b7 Art (choose another) \u00b7 Art (choose another) \u00b7 HUMINT'
      },
      {
          label: 'Athlete',
          skills: ['alertness', 'athletics', 'dodge', 'first_aid', 'humint', 'persuade', 'swim', 'unarmed_combat'],
          desc: 'Alertness \u00b7 Athletics \u00b7 Dodge \u00b7 First Aid \u00b7 HUMINT \u00b7 Persuade \u00b7 Swim \u00b7 Unarmed Combat'
      },
      {
          label: 'Author, Editor, or Journalist',
          skills: ['anthropology', '?art', 'bureaucracy', 'history', 'humint', 'law', 'occult', 'persuade'],
          desc: 'Anthropology \u00b7 Art (choose one: Creative Writing, Journalism, Scriptwriting, etc.) \u00b7 Bureaucracy \u00b7 History \u00b7 HUMINT \u00b7 Law \u00b7 Occult \u00b7 Persuade'
      },
      {
          label: '\u201cBlack Bag\u201d Training',
          skills: ['alertness', 'athletics', 'Craft (Electrician)', 'Craft (Locksmith)', 'criminology', 'disguise', 'search', 'stealth'],
          desc: 'Alertness \u00b7 Athletics \u00b7 Craft (Electrician) \u00b7 Craft (Locksmith) \u00b7 Criminology \u00b7 Disguise \u00b7 Search \u00b7 Stealth'
      },
      {
          label: 'Blue-Collar Worker',
          skills: ['alertness', '?craft', '?craft', 'drive', 'first_aid', 'heavy_machiner', 'navigate', 'search'],
          desc: 'Alertness \u00b7 Craft (choose one) \u00b7 Craft (choose another) \u00b7 Drive \u00b7 First Aid \u00b7 Heavy Machinery \u00b7 Navigate \u00b7 Search'
      },
      {
          label: 'Bureaucrat',
          skills: ['accounting', 'bureaucracy', 'computer_science', 'criminology', 'humint', 'law', 'persuade', '?any'],
          desc: 'Accounting \u00b7 Bureaucracy \u00b7 Computer Science \u00b7 Criminology \u00b7 HUMINT \u00b7 Law \u00b7 Persuade \u00b7 personal specialty (choose one)'
      },
      {
          label: 'Clergy',
          skills: ['?foreign_language', '?foreign_language', '?foreign_language', 'history', 'humint', 'occult', 'persuade', 'psychotherapy'],
          desc: 'Foreign Language (choose one) \u00b7 Foreign Language (choose another) \u00b7 Foreign Language (choose another) \u00b7 History \u00b7 HUMINT \u00b7 Occult \u00b7 Persuade \u00b7 Psychotherapy'
      },
      {
          label: 'Combat Veteran',
          skills: ['alertness', 'dodge', 'firearms', 'first_aid', 'heavy_weapons', 'melee_weapons', 'stealth', 'unarmed_combat'],
          desc: 'Alertness \u00b7 Dodge \u00b7 Firearms \u00b7 First Aid \u00b7 Heavy Weapons \u00b7 Melee Weapons \u00b7 Stealth \u00b7 Unarmed Combat'
      },
      {
          label: 'Computer Enthusiast or Hacker',
          skills: ['computer_science', 'Craft (Microelectronics)', 'Science (Mathematics)', 'sigint', '?any', '?any', '?any', '?any'],
          desc: 'Computer Science \u00b7 Craft (Microelectronics) \u00b7 Science (Mathematics) \u00b7 SIGINT \u00b7 personal specialties \u00d74 (choose freely)'
      },
      {
          label: 'Counselor',
          skills: ['bureaucracy', 'first_aid', '?foreign_language', 'humint', 'law', 'persuade', 'psychotherapy', 'search'],
          desc: 'Bureaucracy \u00b7 First Aid \u00b7 Foreign Language (choose one) \u00b7 HUMINT \u00b7 Law \u00b7 Persuade \u00b7 Psychotherapy \u00b7 Search'
      },
      {
          label: 'Criminalist',
          skills: ['accounting', 'bureaucracy', 'computer_science', 'criminology', 'forensics', 'law', 'pharmacy', 'search'],
          desc: 'Accounting \u00b7 Bureaucracy \u00b7 Computer Science \u00b7 Criminology \u00b7 Forensics \u00b7 Law \u00b7 Pharmacy \u00b7 Search'
      },
      {
          label: 'Firefighter',
          skills: ['alertness', 'demolitions', 'drive', 'first_aid', 'forensics', 'heavy_machiner', 'navigate', 'search'],
          desc: 'Alertness \u00b7 Demolitions \u00b7 Drive \u00b7 First Aid \u00b7 Forensics \u00b7 Heavy Machinery \u00b7 Navigate \u00b7 Search'
      },
      {
          label: 'Gangster or Deep Cover',
          skills: ['alertness', 'criminology', 'dodge', 'drive', 'persuade', 'stealth', '?any_from_list', '?any_from_list'],
          desc: 'Alertness \u00b7 Criminology \u00b7 Dodge \u00b7 Drive \u00b7 Persuade \u00b7 Stealth \u00b7 choose 2 from: Athletics, Foreign Language, Firearms, HUMINT, Melee Weapons, Pharmacy, Unarmed Combat'
      },
      {
          label: 'Interrogator',
          skills: ['criminology', '?foreign_language', '?foreign_language', 'humint', 'law', 'persuade', 'pharmacy', 'search'],
          desc: 'Criminology \u00b7 Foreign Language (choose one) \u00b7 Foreign Language (choose another) \u00b7 HUMINT \u00b7 Law \u00b7 Persuade \u00b7 Pharmacy \u00b7 Search'
      },
      {
          label: 'Liberal Arts Degree',
          skills: ['?anthro_arch', '?art', '?foreign_language', 'history', 'persuade', '?any', '?any', '?any'],
          desc: 'Anthropology or Archeology (choose) \u00b7 Art (choose one) \u00b7 Foreign Language (choose one) \u00b7 History \u00b7 Persuade \u00b7 personal specialties \u00d73 (choose freely)'
      },
      {
          label: 'Military Officer',
          skills: ['bureaucracy', 'firearms', 'history', '?military_science', 'navigate', 'persuade', 'unarmed_combat', '?any_from_list'],
          desc: 'Bureaucracy \u00b7 Firearms \u00b7 History \u00b7 Military Science (choose one) \u00b7 Navigate \u00b7 Persuade \u00b7 Unarmed Combat \u00b7 choose 1 from: Artillery, Heavy Machinery, Heavy Weapons, HUMINT, Pilot, SIGINT'
      },
      {
          label: 'MBA',
          skills: ['accounting', 'bureaucracy', 'humint', 'law', 'persuade', '?any', '?any', '?any'],
          desc: 'Accounting \u00b7 Bureaucracy \u00b7 HUMINT \u00b7 Law \u00b7 Persuade \u00b7 personal specialties \u00d73 (choose freely)'
      },
      {
          label: 'Nurse, Paramedic, or Pre-Med',
          skills: ['alertness', 'first_aid', 'medicine', 'persuade', 'pharmacy', 'psychotherapy', 'Science (Biology)', 'search'],
          desc: 'Alertness \u00b7 First Aid \u00b7 Medicine \u00b7 Persuade \u00b7 Pharmacy \u00b7 Psychotherapy \u00b7 Science (Biology) \u00b7 Search'
      },
      {
          label: 'Occult Investigator or Conspiracy Theorist',
          skills: ['anthropology', 'archeology', 'computer_science', 'criminology', 'history', 'occult', 'persuade', 'search'],
          desc: 'Anthropology \u00b7 Archeology \u00b7 Computer Science \u00b7 Criminology \u00b7 History \u00b7 Occult \u00b7 Persuade \u00b7 Search'
      },
      {
          label: 'Outdoorsman',
          skills: ['alertness', 'athletics', 'firearms', 'navigate', 'ride', 'search', 'stealth', 'survival'],
          desc: 'Alertness \u00b7 Athletics \u00b7 Firearms \u00b7 Navigate \u00b7 Ride \u00b7 Search \u00b7 Stealth \u00b7 Survival'
      },
      {
          label: 'Photographer',
          skills: ['alertness', 'Art (Photography)', 'computer_science', 'persuade', 'search', 'stealth', '?any', '?any'],
          desc: 'Alertness \u00b7 Art (Photography) \u00b7 Computer Science \u00b7 Persuade \u00b7 Search \u00b7 Stealth \u00b7 personal specialties \u00d72 (choose freely)'
      },
  ];

  /* ── Damaged Veteran (Agent's Handbook p.39), applied by the wizard ── */
  var VETERAN = [
    { key: 'violence', title: 'Extreme Violence', blurb: 'Has seen and done the worst, in combat or crime.',
      lines: ['+10% Occult', '−5 SAN', '−3 CHA, and −3 from each Bond', 'Adapted to Violence'],
      occult: 10, san: -5, cha: -3, bondLoss: 3, adapt: 'violence' },
    { key: 'captivity', title: 'Captivity or Imprisonment', blurb: 'Was held, broken down, and came out the other side.',
      lines: ['+10% Occult', '−5 SAN', '−3 POW (Sanity unchanged)', 'Adapted to Helplessness'],
      occult: 10, san: -5, pow: -3, adapt: 'helplessness' },
    { key: 'hard', title: 'Hard Experience', blurb: 'A life that taught hard lessons the hard way.',
      lines: ['+10% Occult', '+10% to any four skills (not Unnatural; may go above 80%)', '−5 SAN', 'Remove one Bond'],
      occult: 10, san: -5, fourSkills: 10, removeBond: true },
    { key: 'unnatural', title: 'Things Man Was Not Meant to Know', blurb: 'Has already brushed against the unnatural.',
      lines: ['+10% Unnatural', '+20% Occult', 'Lose SAN equal to POW', 'A new disorder caused by the Unnatural', 'Breaking Point reset to the new SAN − POW'],
      unnatural: 10, occult: 20, sanMinusPow: true, disorder: true }
  ];

  function complexProfession(key) { return COMPLEX.filter(function (p) { return p.key === key; })[0] || null; }
  function label(key) {
    var c = complexProfession(key);
    if (c) return c.title;
    try { var p = typeof professions !== 'undefined' ? professions : window.professions; if (p && p[key]) return p[key].title; } catch (e) { /* none */ } // eslint-disable-line no-undef
    return '';
  }

  window.dgRecruitData = {
    STAT_INFO: STAT_INFO, suggestFeature: suggestFeature,
    COMPLEX: COMPLEX, complexProfession: complexProfession, POSTINGS: POSTINGS,
    KITS: KITS, kitFor: kitFor,
    BOND_CATS: BOND_CATS, bondList: bondList, randomBond: randomBond,
    VETERAN: VETERAN, BONUS_PACKAGES: BONUS_PACKAGES, label: label
  };
})();
