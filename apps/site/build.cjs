#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Assembles dist/: the static site and the shared fonts. There is no browser version
// of the game (docs/MONETIZATION.md): the site describes it and links to the stores.
//   node apps/site/build.cjs
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..'), OUT = path.join(__dirname, 'dist');
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };
fs.rmSync(OUT, { recursive: true, force: true });
copy(path.join(__dirname, 'public'), OUT);
copy(path.join(ROOT, 'vendor/fonts'), path.join(OUT, 'fonts'));
copy(path.join(ROOT, 'apps/play/public/ozy.css'), path.join(OUT, 'ozy.css')); // one stylesheet for site, portal and admin
copy(path.join(ROOT, 'icon.svg'), path.join(OUT, 'icon.svg'));
fs.writeFileSync(path.join(OUT, 'living-logo.js'), require(path.join(ROOT, 'tools/living-logo.cjs')).build());
console.log('site dist ready:', OUT);
