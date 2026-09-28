// Meta-progression: a persistent Lineage (XP, level, titles), achievements that
// unlock preset Spawnforge designs, and per-culture records. Stored locally; it never
// changes match balance (unlocks are cosmetic titles and designs anyone could build).
(function (E) {
  'use strict';
  const KEY = 'efl.profile';
  const TITLES = [[1, 'Drifter'], [2, 'Spawnling'], [3, 'Tender'], [5, 'Lamplighter'], [7, 'Luminary'], [10, 'Tidecaller'], [14, 'Abyssal'], [19, 'Leviathan-lord'], [25, 'Ozymandian']];
  const ACH = [
    { id: 'first', name: 'First Light', desc: 'Win a match.', test: r => r.won },
    { id: 'hard', name: 'Into the Deep', desc: 'Win against an Abyssal or Leviathan bot.', test: r => r.won && r.hardest >= 2 },
    { id: 'brutal', name: 'Leviathan Slayer', desc: 'Win against a Leviathan bot.', test: r => r.won && r.hardest >= 3 },
    { id: 'ffa', name: 'Last Light Standing', desc: 'Win a free-for-all with 4+ cultures.', test: r => r.won && r.players >= 4 && r.ffa },
    { id: 'abyss', name: 'Abyss Walker', desc: 'Win on an Abyss-size map.', test: r => r.won && r.size === 'xl' },
    { id: 'evolve', name: 'Radiant Evolution', desc: 'Complete 20 evolutions in one match.', test: r => r.evolved >= 20 },
    { id: 'expand', name: 'Budding Empire', desc: 'Have 4 structures bloom in one match.', test: r => r.built >= 4 },
    { id: 'swarm', name: 'Tide of Bodies', desc: 'Hatch 150 creatures in one match.', test: r => r.hatched >= 150 },
    { id: 'hunter', name: 'Apex Hunger', desc: 'Slay 200 creatures in one match.', test: r => r.kills >= 200 },
    { id: 'quick', name: 'Brief and Burning', desc: 'Win in under 8 minutes.', test: r => r.won && r.time < 480 },
    { id: 'tide', name: 'Tidekeeper', desc: 'Win a Hold the Tide match.', test: r => r.won && r.mode === 'tide' },
    { id: 'heart', name: 'Heartfall', desc: 'Win a Heartfall match.', test: r => r.won && r.mode === 'regicide' },
    { id: 'lumen', name: 'Luminous', desc: 'Win a Luminance race.', test: r => r.won && r.mode === 'bloom' },
    { id: 'online', name: 'Shared Waters', desc: 'Finish an online match.', test: r => r.online },
    { id: 'all6', name: 'Six Lights', desc: 'Win with every culture.', test: (r, p) => Object.keys(p.cultureWins).length >= 6 },
    { id: 'tutor', name: 'Spawned', desc: 'Finish the tutorial.', test: r => r.tutorial && r.won },
  ];
  // Each achievement adds a preset design to your Spawnforge library.
  const REWARDS = {
    first: { name: 'Dawnwhip', chassis: 'serpent', organs: ['sawjaw', 'twinwhip', 'feelers'] },
    hard: { name: 'Deepmaw', chassis: 'carapace', organs: ['pincers', 'stilts', 'thorn', 'whiptail'] },
    brutal: { name: 'Kraken-knight', chassis: 'nautiloid', organs: ['venom', 'stilts', 'horns', 'jetsiphon'] },
    ffa: { name: 'Lastlight', chassis: 'ctenophore', organs: ['nematocyst', 'eyestalks', 'corkscrew'] },
    abyss: { name: 'Abyss Lantern', chassis: 'medusa', organs: ['proboscis', 'plumes', 'tubefeet'] },
    evolve: { name: 'Chimera Prime', chassis: 'siphonophore', organs: ['nematocyst', 'horns', 'sporesacs', 'stilts', 'finveil', 'whiskers'] },
    expand: { name: 'Pollinator', chassis: 'siphonophore', organs: ['combs', 'fronds', 'paddles', 'whiptail'], role: 'harvest' },
    swarm: { name: 'Mite', chassis: 'serpent', organs: ['nippers', 'twinwhip'] },
    hunter: { name: 'Reaper', chassis: 'serpent', organs: ['sawjaw', 'stinger', 'grapnel', 'whiskers'] },
    quick: { name: 'Flashfin', chassis: 'ctenophore', organs: ['pincers', 'jetsiphon', 'twinwhip'] },
    tide: { name: 'Tidewarden', chassis: 'carapace', organs: ['pincers', 'stilts', 'tubefeet', 'horns'] },
    heart: { name: 'Heartseeker', chassis: 'ctenophore', organs: ['proboscis', 'eyestalks', 'jetsiphon'] },
    lumen: { name: 'Glowgleaner', chassis: 'serpent', organs: ['fronds', 'combs', 'corkscrew', 'lures'], role: 'harvest' },
    online: { name: 'Messenger', chassis: 'medusa', organs: ['photophores', 'plumes', 'nippers'] },
    all6: { name: 'Sixfold', chassis: 'siphonophore', organs: ['pincers', 'venom', 'horns', 'sporesacs', 'stilts', 'jetsiphon'] },
    tutor: { name: 'Hatchling', chassis: 'serpent', organs: ['nippers', 'fuzz', 'whiptail'] },
  };
  const blank = () => ({ xp: 0, wins: 0, losses: 0, matches: 0, cultureWins: {}, ach: {}, best: {} });
  E.Profile = {
    ACH, TITLES,
    get() { return Object.assign(blank(), E.LS.get(KEY, {})); },
    save(p) { E.LS.set(KEY, p); if (E.Cloud) E.Cloud.dirty('profile'); },
    level(xp) { return 1 + Math.floor(Math.sqrt(xp / 120)); },
    levelXp(lvl) { return 120 * (lvl - 1) * (lvl - 1); },
    title(lvl) { let t = TITLES[0][1]; for (const [l, n] of TITLES) if (lvl >= l) t = n; return t; },
    // Called once per finished match with a summary; returns what was earned.
    award(r) {
      const p = this.get(), lvl0 = this.level(p.xp);
      let xp = r.won ? 300 : 110;
      xp += Math.min(200, r.kills * 1.5) + Math.min(150, r.evolved * 6) + Math.min(100, r.built * 20) + (r.hardest || 0) * 60 + (r.players - 2) * 25;
      if (r.tutorial) xp = Math.max(xp, 250);
      xp = Math.round(xp);
      p.xp += xp; p.matches++; if (r.won) { p.wins++; p.cultureWins[r.culture] = (p.cultureWins[r.culture] || 0) + 1; } else p.losses++;
      const got = [];
      for (const a of ACH) if (!p.ach[a.id] && a.test(r, p)) { p.ach[a.id] = Date.now(); got.push(a); const d = REWARDS[a.id]; if (d && E.Library) E.Library.add(d); }
      this.save(p);
      const lvl1 = this.level(p.xp);
      return { xp, total: p.xp, level: lvl1, levelUp: lvl1 > lvl0, title: this.title(lvl1), got, progress: (p.xp - this.levelXp(lvl1)) / (this.levelXp(lvl1 + 1) - this.levelXp(lvl1)) };
    },
    summary() { const p = this.get(), l = this.level(p.xp); return { level: l, title: this.title(l), xp: p.xp, wins: p.wins, matches: p.matches, ach: Object.keys(p.ach).length }; },
  };
})(window.E);
