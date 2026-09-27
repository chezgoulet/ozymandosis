// Tech tree and the six cultures.
(function (E) {
  'use strict';

  // ── Tech tree ───────────────────────────────────────────────────
  // key forms: tier:<cls>:<level>, form:<organId>, chassis:<id>, power:<id>
  const TIER_COST = [null, { l: 90, s: 0, time: 14 }, { l: 170, s: 20, time: 20 }, { l: 280, s: 60, time: 28 }];
  const FORM_COST = [null, null, { l: 80, s: 0, time: 12, tier: 0 }, { l: 110, s: 0, time: 14, tier: 1 }, { l: 140, s: 15, time: 16, tier: 1 }, { l: 170, s: 30, time: 18, tier: 2 }, { l: 220, s: 45, time: 20, tier: 2 }];
  const CHASSIS_COST = {
    carapace: { l: 140, s: 0, time: 16 }, ctenophore: { l: 140, s: 0, time: 16 },
    medusa: { l: 180, s: 30, time: 20, req: p => p.forms.length >= 7, reqText: 'Requires 2 evolved forms' },
    siphonophore: { l: 180, s: 30, time: 20, req: p => p.forms.length >= 7, reqText: 'Requires 2 evolved forms' },
    nautiloid: { l: 240, s: 50, time: 24, req: p => Object.values(p.tier).some(v => v >= 2), reqText: 'Requires any organ at tier III' },
  };
  const T = [];
  for (const cls of E.CLASS_IDS) {
    for (let lvl = 1; lvl <= 3; lvl++) {
      const c = TIER_COST[lvl];
      T.push({ key: `tier:${cls}:${lvl}`, kind: 'tier', cls, lvl, name: `${E.CLASSES[cls].name} ${['I', 'II', 'III', 'IV'][lvl]}`,
        desc: `Every ${E.CLASSES[cls].name.toLowerCase()} organ grows to variant ${E.TIER_V[lvl]}.`, cost: { l: c.l, s: c.s }, time: c.time,
        req: p => p.tier[cls] === lvl - 1, reqText: lvl > 1 ? `Requires ${E.CLASSES[cls].name} ${['I', 'II', 'III'][lvl - 1]}` : '',
        have: p => p.tier[cls] >= lvl });
    }
    for (const o of E.organsOf(cls)) {
      if (o.form === 1) continue;
      const c = FORM_COST[o.form];
      T.push({ key: `form:${o.id}`, kind: 'form', cls, organ: o.id, name: o.name, desc: o.blurb, cost: { l: c.l, s: c.s }, time: c.time,
        req: p => p.tier[cls] >= c.tier, reqText: c.tier ? `Requires ${E.CLASSES[cls].name} ${['I', 'II', 'III'][c.tier]}` : '',
        have: p => p.forms.includes(o.id) });
    }
  }
  for (const ch of E.CHASSIS_LIST) {
    if (ch.id === 'serpent') continue;
    const c = CHASSIS_COST[ch.id];
    T.push({ key: `chassis:${ch.id}`, kind: 'chassis', chassis: ch.id, name: ch.name, desc: ch.blurb, cost: { l: c.l, s: c.s }, time: c.time,
      req: c.req || (() => true), reqText: c.reqText || '', have: p => p.chassis.includes(ch.id) });
  }
  for (const pw of E.POWER_LIST) {
    T.push({ key: `power:${pw.id}`, kind: 'power', power: pw.id, name: pw.name, desc: pw.desc, cost: pw.cost, time: pw.time,
      req: pw.req || (() => true), reqText: pw.reqText || '', have: p => p.specials.includes(pw.id) });
  }
  E.TECHS = {}; T.forEach(t => (E.TECHS[t.key] = t));
  E.TECH_LIST = T;

  // ── Cultures (colors straight from the seed's _SWIMMER_COLORS) ─
  const BASE = { hp: 1, speed: 1, attack: 1, harvest: 1, sense: 1, cost: 1, hatch: 1, research: 1 };
  const C = [
    { id: 'verdant', name: 'The Verdant Strain', short: 'Verdant', epithet: 'Gardeners of the Drift', spec: 'Economy',
      rule: 'Harvest ×1.5 · Bite ×0.8', mods: { harvest: 1.5, attack: 0.8 }, pressures: ['umbral', 'choir'], persona: 'boom', affinity: 'pili', startForm: 'fronds', startChassis: 'siphonophore',
      aiResearch: ['tier:pili:1', 'form:combs', 'power:roots', 'tier:leg:1', 'tier:mandible:1', 'power:mitosis', 'form:tubefeet', 'tier:mandible:2', 'power:symbiosis', 'form:pincers'],
      blurb: 'Patient tenders who out-grow and out-research their rivals, then drown them in bodies.' },
    { id: 'luminant', name: 'The Luminants', short: 'Luminants', epithet: 'Keepers of the Gold Spore', spec: 'Generalist · Tech',
      rule: 'Research ×0.6 cost and time · +50% spore', mods: { research: 0.6 }, pressures: ['current', 'choir'], persona: 'tech', sporeMul: 1.5, affinity: null, startForm: 'eyestalks', startChassis: 'nautiloid',
      aiResearch: ['tier:mandible:1', 'form:nematocyst', 'chassis:ctenophore', 'tier:antenna:1', 'power:chitin', 'tier:mandible:2', 'form:horns', 'power:bloom', 'tier:leg:1', 'power:apex'],
      blurb: 'Emerald and gold, without a glaring weakness. Their gift is evolution itself.' },
    { id: 'current', name: 'The Current-born', short: 'Current-born', epithet: 'Riders of the Long Water', spec: 'Mobility · Raids',
      rule: 'Speed ×1.35 · HP ×0.85', mods: { speed: 1.35, hp: 0.85 }, pressures: ['verdant', 'umbral'], persona: 'raider', affinity: 'flagella', startForm: 'jetsiphon', startChassis: 'ctenophore',
      aiResearch: ['tier:flagella:1', 'tier:mandible:1', 'form:twinwhip', 'form:sawjaw', 'power:frenzy', 'tier:mandible:2', 'power:tidecall', 'tier:flagella:2', 'power:hunger'],
      blurb: 'Fast, fragile and never where you left them. They punish greedy economies.' },
    { id: 'choir', name: 'The Deep Choir', short: 'Deep Choir', epithet: 'Listeners in the Dark', spec: 'Sensing · Ambush',
      rule: 'Sense ×1.5 · Unseen beyond 55 · Ambush 2× bite', mods: { sense: 1.5 }, pressures: ['current', 'bloom'], persona: 'turtle', stealth: true, affinity: 'antenna', startForm: 'photophores', startChassis: 'medusa',
      aiResearch: ['tier:antenna:1', 'tier:mandible:1', 'form:whiskers', 'form:proboscis', 'power:hivemind', 'tier:mandible:2', 'power:flare', 'form:horns', 'power:metamorph'],
      blurb: 'Violet singers who hear everything and strike from where no one is looking.' },
    { id: 'umbral', name: 'The Umbral Kin', short: 'Umbral Kin', epithet: 'The Tethered Hunger', spec: 'Parasitism · Conversion',
      rule: '30% of kills rise again as Umbral', mods: { harvest: 0.9 }, pressures: ['bloom', 'luminant'], persona: 'tech', convert: 0.3, affinity: 'pili', startForm: 'tether', startChassis: 'nautiloid',
      aiResearch: ['tier:mandible:1', 'tier:pili:1', 'form:venom', 'power:hunger', 'tier:leg:1', 'tier:mandible:2', 'form:thorn', 'power:bloom', 'power:metamorph'],
      blurb: 'They don’t kill their enemies so much as recruit them.' },
    { id: 'bloom', name: 'The Bloomtide', short: 'Bloomtide', epithet: 'The Brief and Burning', spec: 'Aggression · Swarm',
      rule: 'Cost ×0.6 · Hatch ×0.6 · Bite ×1.25 · Live 90s', mods: { cost: 0.6, hatch: 0.6, attack: 1.25 }, pressures: ['verdant', 'luminant'], persona: 'swarm', lifespan: 90, popBonus: 30, affinity: 'mandible', startForm: 'pincers', startChassis: 'carapace',
      aiResearch: ['tier:mandible:1', 'power:frenzy', 'form:sawjaw', 'tier:leg:1', 'tier:mandible:2', 'power:mitosis', 'form:stinger', 'power:hunger', 'tier:mandible:3'],
      blurb: 'Cheap, vicious and gone in ninety seconds. They win early or not at all.' },
  ];
  C.forEach((c, i) => {
    c.idx = i;
    c.colors = BioluminescentDreamscape._SWIMMER_COLORS[i];
    c.hex = c.colors.map(E.toHex);
    c.mods = Object.assign({}, BASE, c.mods);
  });
  E.CULTURES = {}; C.forEach(c => (E.CULTURES[c.id] = c));
  E.CULTURE_LIST = C;

  // ── Built-in designs ────────────────────────────────────────────
  E.BUILTIN_DESIGNS = {
    _forager: { id: '_forager', name: 'Forager', chassis: 'serpent', organs: ['fuzz', 'whiptail'], role: 'harvest' },
    _warden: { id: '_warden', name: 'Warden', chassis: 'serpent', organs: ['nippers', 'cilia', 'feelers'] },
    _sporeling: { id: '_sporeling', name: 'Sporeling', chassis: 'serpent', organs: ['nippers', 'whiptail'], hidden: true },
    _leviathan: { id: '_leviathan', name: 'Leviathan', chassis: 'leviathan', organs: ['pincers', 'nippers', 'stilts', 'stilts', 'twinwhip', 'plumes', 'horns', 'thorn'], hidden: true },
  };
  // Signature designs per culture, built from their starting unlocks
  E.SIGNATURES = {
    verdant: { id: 'sig', name: 'Tender', chassis: 'siphonophore', organs: ['fronds', 'fronds', 'cilia', 'whiptail'], role: 'harvest' },
    luminant: { id: 'sig', name: 'Lantern', chassis: 'nautiloid', organs: ['nippers', 'eyestalks', 'cilia', 'whiptail'] },
    current: { id: 'sig', name: 'Lancer', chassis: 'ctenophore', organs: ['nippers', 'jetsiphon', 'whiptail'] },
    choir: { id: 'sig', name: 'Cantor', chassis: 'medusa', organs: ['nippers', 'photophores', 'feelers'] },
    umbral: { id: 'sig', name: 'Tether', chassis: 'nautiloid', organs: ['tether', 'nippers', 'cilia'] },
    bloom: { id: 'sig', name: 'Petalmaw', chassis: 'carapace', organs: ['pincers', 'nippers', 'cilia'] },
  };
  // Bot design templates: first unlocked option per slot is used.
  E.AI_TEMPLATES = [
    { name: 'Brawler', chassis: ['carapace', 'nautiloid', 'serpent'], slots: [['pincers', 'sawjaw', 'nippers'], ['stilts', 'thorn', 'cilia'], ['stinger', 'whiptail'], ['venom', 'nippers']] },
    { name: 'Skirmisher', chassis: ['ctenophore', 'serpent'], slots: [['sawjaw', 'nippers'], ['twinwhip', 'corkscrew', 'whiptail'], ['jetsiphon', 'whiptail']] },
    { name: 'Artillery', chassis: ['ctenophore', 'serpent'], slots: [['nematocyst'], ['eyestalks', 'feelers'], ['whiptail']], needs: 'nematocyst' },
    { name: 'Warder', chassis: ['medusa', 'siphonophore', 'serpent'], slots: [['horns', 'feelers'], ['sporesacs', 'fuzz'], ['proboscis', 'nippers'], ['tubefeet', 'cilia']], needs: 'horns' },
    { name: 'Siege', chassis: ['siphonophore', 'carapace', 'serpent'], slots: [['pincers', 'nippers'], ['pincers', 'nippers'], ['stilts', 'cilia'], ['thorn', 'cilia'], ['whiptail'], ['plumes', 'feelers']] },
  ];
})(typeof window !== 'undefined' ? window.E : globalThis.E);
