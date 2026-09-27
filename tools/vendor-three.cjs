#!/usr/bin/env node
// Rebuild the vendored three.js bundles (IIFE globals) so the game keeps running
// from file:// with no bundler. Run after bumping the three devDependency:
//   node tools/vendor-three.cjs
'use strict';
const esbuild = require('esbuild'), path = require('path'), fs = require('fs');
const out = path.join(__dirname, '..', 'vendor');
const ver = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'three', 'package.json'), 'utf8')).version;
const banner = `/* three.js r${ver.split('.')[1]} (MIT) vendored by tools/vendor-three.cjs */`;
(async () => {
  await esbuild.build({ stdin: { contents: "export * from 'three';", resolveDir: __dirname }, bundle: true, minify: true, format: 'iife', globalName: 'THREE', outfile: path.join(out, 'three.min.js'), banner: { js: banner }, legalComments: 'none' });
  await esbuild.build({ stdin: { contents: "export * from 'three/webgpu'; export * as TSL from 'three/tsl';", resolveDir: __dirname }, bundle: true, minify: true, format: 'iife', globalName: 'THREE_GPU', outfile: path.join(out, 'three.webgpu.min.js'), banner: { js: banner }, legalComments: 'none' });
  fs.writeFileSync(path.join(out, 'VERSION'), `three ${ver}\n`);
  for (const f of ['three.min.js', 'three.webgpu.min.js']) console.log(f, (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KB');
})();
