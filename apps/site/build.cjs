#!/usr/bin/env node
// Assembles dist/: the static site, the shared fonts, and the web client at /play/.
//   node apps/site/build.cjs   (run tools/build-web.cjs first so www/ exists)
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..'), OUT = path.join(__dirname, 'dist');
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };
fs.rmSync(OUT, { recursive: true, force: true });
copy(path.join(__dirname, 'public'), OUT);
copy(path.join(ROOT, 'vendor/fonts'), path.join(OUT, 'fonts'));
copy(path.join(ROOT, 'apps/play/public/ozy.css'), path.join(OUT, 'ozy.css')); // one stylesheet for site, portal and admin
const www = path.join(ROOT, 'www');
if (!fs.existsSync(www)) { console.error('www/ is missing: run node tools/build-web.cjs first'); process.exit(1); }
copy(www, path.join(OUT, 'play'));
console.log('site dist ready:', OUT);
