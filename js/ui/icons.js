// Organic line icons (24×24, currentColor). Every glyph is a body part or a
// living process, never a manufactured object: claws, not swords.
(function (E) {
  'use strict';
  const P = {
    // three raking talons
    claws: '<path d="M4.2 3.2c3.4 3.6 4.4 9.4 1.2 17.4 1-5.2.2-10.8-1.2-17.4Z" fill="currentColor" stroke="none"/><path d="M10.4 2.2c3.6 4 4.4 10.2 1 18.6 1.1-5.6.3-11.6-1-18.6Z" fill="currentColor" stroke="none"/><path d="M16.6 3.2c3.4 3.6 4.4 9.4 1.2 17.4 1-5.2.2-10.8-1.2-17.4Z" fill="currentColor" stroke="none"/><path d="M3 21.2h17.4" opacity=".35"/>',
    // a curled, sleeping grub
    grub: '<path d="M16.5 17.6a7.2 7.2 0 1 1 2.7-7.6"/><path d="M15.7 12.4a3.6 3.6 0 1 0-3.4 4.4"/><path d="M8.4 6.7l1 1.4M5.8 10.2l1.6.6M6 14.4l1.6-.5M8.8 17.4l.9-1.4"/><circle cx="18.6" cy="12.6" r="1.2" fill="currentColor" stroke="none"/><path d="M19.5 4.3h2.4l-2.4 2.6h2.4" stroke-width="1.3"/>',
    // cell with nucleus and organelles
    nucleus: '<path d="M12 2.8c4.6-.2 8.9 3.6 9 8.6.2 5.3-3.8 9.6-9.1 9.8C6.6 21.3 2.9 17.6 2.9 12.4 2.8 7.2 7 3 12 2.8Z"/><circle cx="12.4" cy="11.6" r="3.6" fill="currentColor" fill-opacity=".28"/><circle cx="12.9" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="6.8" cy="9.4" r="1" fill="currentColor" stroke="none"/><circle cx="17.4" cy="16.2" r="1.1" fill="currentColor" stroke="none"/><path d="M7.4 16.4c1 .6 2 .6 2.8 0" />',
    // double helix
    helix: '<path d="M7 2.5c0 4.8 10 4.8 10 9.5S7 16.7 7 21.5"/><path d="M17 2.5c0 4.8-10 4.8-10 9.5s10 4.7 10 9.5"/><path d="M8.6 5h6.8M10.3 8.3h3.4M10.3 15.7h3.4M8.6 19h6.8" opacity=".6"/>',
    // an egg with a coiled embryo: the Spawnforge
    egg: '<path d="M12 2.6c4.2 0 7.4 6.3 7.4 11 0 4.4-3.3 7.8-7.4 7.8s-7.4-3.4-7.4-7.8c0-4.7 3.2-11 7.4-11Z"/><path d="M13.8 16.6a3.4 3.4 0 1 1 1-4.4c.5 1.2 0 2.4-1.2 2.6-1 .2-1.7-.6-1.4-1.4"/><circle cx="10.2" cy="11.3" r=".9" fill="currentColor" stroke="none"/>',
    // tendrils, stacked
    tendrils: '<path d="M3.5 6.5c3-2 5.4 2 8.5 0s5.5 2 8.5 0"/><path d="M3.5 12c3-2 5.4 2 8.5 0s5.5 2 8.5 0"/><path d="M3.5 17.5c3-2 5.4 2 8.5 0s5.5 2 8.5 0"/>',
    // a spiral conch sounding
    conch: '<path d="M4 15.5c0-4.6 3.4-8 7.3-8 2.8 0 4.7 1.9 4.7 4.3 0 2-1.5 3.4-3.3 3.4-1.4 0-2.4-1-2.4-2.3 0-1 .7-1.7 1.6-1.7"/><path d="M4 15.5l3.2 3.2c2.4 1.2 6 .9 8.6-1.2"/><path d="M18.4 8.6c1.1 1.2 1.7 2.6 1.7 4.2M20.4 6.2c1.8 1.8 2.8 4.1 2.8 6.6" opacity=".75"/>',
    conchMute: '<path d="M4 15.5c0-4.6 3.4-8 7.3-8 2.8 0 4.7 1.9 4.7 4.3 0 2-1.5 3.4-3.3 3.4-1.4 0-2.4-1-2.4-2.3 0-1 .7-1.7 1.6-1.7"/><path d="M4 15.5l3.2 3.2c2.4 1.2 6 .9 8.6-1.2"/><path d="M18.2 8.4l4 4M22.2 8.4l-4 4" opacity=".85"/>',
    // a spore-cell speaking
    speech: '<path d="M12 3.6c5 0 8.8 3.3 8.8 7.4s-3.8 7.4-8.8 7.4c-1 0-2-.1-2.9-.4L4.6 20.4l1.3-3.9C4.2 15.2 3.2 13.2 3.2 11 3.2 6.9 7 3.6 12 3.6Z"/><circle cx="8.6" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="15.4" cy="11" r="1" fill="currentColor" stroke="none"/>',
    // command fallbacks
    lunge: '<path d="M3 17c4-1 7-4 9-8l2.6-5.2"/><path d="M11.6 4.2l3-.6 1.8 2.6"/><path d="M14 13c2.2.6 4.4 2.6 6.4 6.6"/><path d="M5.6 20.4c3.4-.4 6.8-2.4 9-5.4" opacity=".55"/>',
    fin: '<path d="M3.4 16.6c4.8-.4 9-3 12.4-8.6l4.8-4.4-1 6.4c-2 5.6-6.6 8.4-12.6 8.4"/><path d="M7 16.6l2.6-4M10.6 15.4l2.6-4.2M14 13.4l2.4-4" opacity=".6"/>',
    closed: '<path d="M12 3.4c4.8 0 8.6 3.9 8.6 8.6S16.8 20.6 12 20.6 3.4 16.8 3.4 12 7.2 3.4 12 3.4Z"/><path d="M8 12c2.6-1.6 5.4-1.6 8 0" stroke-width="2.2"/>',
    shell: '<path d="M12 3.2 20 7v5.2c0 4.3-3.4 7.6-8 8.6-4.6-1-8-4.3-8-8.6V7l8-3.8Z"/><path d="M12 6.2v11.4M7.2 9.4c3 1.4 6.6 1.4 9.6 0M7.6 13.6c2.8 1.2 6 1.2 8.8 0" opacity=".6"/>',
    orbit: '<path d="M19.8 9.4A8.2 8.2 0 1 0 20 14"/><path d="M20.6 4.6v5.2h-5.2"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
    chain: '<path d="M4 12c2.4-3 4.6-3 7 0s4.6 3 7 0"/><circle cx="4" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="11" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M20.4 9.6 22 12l-1.6 2.4" opacity=".7"/>',
    droplet: '<path d="M12 2.8c3.6 4.6 6.4 8.2 6.4 11.4a6.4 6.4 0 1 1-12.8 0c0-3.2 2.8-6.8 6.4-11.4Z"/><path d="M9.2 14.6c.2 1.6 1.2 2.6 2.8 2.8" opacity=".7"/>',
    spore: '<circle cx="12" cy="12" r="3.4" fill="currentColor" fill-opacity=".3"/><path d="M12 3v3.6M12 17.4V21M3 12h3.6M17.4 12H21M5.6 5.6l2.6 2.6M15.8 15.8l2.6 2.6M5.6 18.4l2.6-2.6M15.8 8.2l2.6-2.6"/>',
    polyp: '<path d="M8 21c0-5 .6-9 4-12.4C15.4 12 16 16 16 21"/><path d="M12 8.6C9.6 6.4 7.4 5.6 5 6M12 8.6c2.4-2.2 4.6-3 7-2.6M12 8.6V3.2"/><circle cx="5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="3.2" r="1" fill="currentColor" stroke="none"/>',
    bud: '<path d="M12 21v-6"/><path d="M12 15c-4.4 0-7-3-7-7 3.6 0 6 1.4 7 4 1-2.6 3.4-4 7-4 0 4-2.6 7-7 7Z"/><path d="M12 12c-1.4-2.6-1.4-5.4 0-8.6 1.4 3.2 1.4 6 0 8.6Z"/>',
    flag: '<path d="M6 21V3.6"/><path d="M6 4.2c3.4-1.8 6.2 1.8 9.6 0 1.4-.7 2.6-.8 3.6-.4-.6 3.6-.2 6 .6 8-3.4 1.6-6.2-1.6-9.6.2-1.6.8-3 .9-4.2.4"/>',
    eye: '<path d="M2.6 12c2.6-4.4 5.8-6.6 9.4-6.6s6.8 2.2 9.4 6.6c-2.6 4.4-5.8 6.6-9.4 6.6S5.2 16.4 2.6 12Z"/><circle cx="12" cy="12" r="3.2" fill="currentColor" fill-opacity=".3"/><path d="M12 9.6v4.8" stroke-width="2"/>',
    // a wound knitting shut: a cell split by a seam, stitched across
    mend: '<path d="M12 3.4c4.8 0 8.6 3.9 8.6 8.6S16.8 20.6 12 20.6 3.4 16.8 3.4 12 7.2 3.4 12 3.4Z"/><path d="M5.4 12.6c2.2-1.6 4.4 1.2 6.6-.4s4.4 1.2 6.6-.4"/><path d="M8 9.8l1 4.6M12 9.4v5.2M16 9.8l-1 4.6" stroke-width="1.4"/>',
    cancel: '<path d="M6 6c3.6 3.2 8.4 8.8 12 12M18 6c-3.4 3.4-8.6 8.6-12 12"/>',
    back: '<path d="M14.6 5.2C11.4 7.8 8.8 10 7 12c1.8 2 4.4 4.2 7.6 6.8"/><path d="M7.6 12H20" opacity=".6"/>',
    queue: '<circle cx="5" cy="17" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="7" r="1.8"/><path d="M6.6 15.8 10.4 13.2M13.6 10.8l3.8-2.6" stroke-dasharray="1.6 1.8"/>',
  };
  // label (as used on command buttons) → icon
  E.ICON_FOR = { Army: 'claws', Idle: 'grub', Hatch: 'nucleus', Home: 'nucleus', Evolve: 'helix', Spawnforge: 'egg', Attack: 'lunge', Move: 'fin', Stop: 'closed', Hold: 'shell',
    Patrol: 'orbit', Mend: 'mend', Queue: 'queue', Harvest: 'droplet', Spore: 'spore', Build: 'bud', Rally: 'flag', Next: 'eye', Cancel: 'cancel' };
  E.iconSvg = function (name, cls) {
    const body = P[name]; if (!body) return '';
    return `<svg class="svg-ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  };
  E.icon = function (name, cls) {
    const t = document.createElement('template'); t.innerHTML = E.iconSvg(name, cls);
    return t.content.firstChild;
  };
  // Hydrate <i data-icon="name"> placeholders in static markup.
  E.hydrateIcons = function (root) {
    (root || document).querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = E.iconSvg(el.getAttribute('data-icon')); });
  };
})(window.E);
