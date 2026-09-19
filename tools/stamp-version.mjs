#!/usr/bin/env node
/* ══════════════════════════════════════════════════════
   tools/stamp-version.mjs
   Añade ?v=<hash> a TODAS las referencias locales a .js y .css (imports de
   módulos, <script>, <link>, modulepreload). El hash sale del contenido de los
   .js/.css, así que cambia sólo cuando cambia el código.

   ¿Para qué? Vercel puede entonces servir los .js/.css con caché de un año
   («immutable»): en visitas repetidas el navegador no vuelve a pedir ningún
   módulo. Cuando el código cambia, el hash cambia y todas las URLs son nuevas.
   Los HTML siguen revalidándose siempre, por eso nunca apuntan a código viejo.

   Uso:
     node tools/stamp-version.mjs          reescribe los archivos
     node tools/stamp-version.mjs --check  falla (exit 1) si algo está desactualizado
   Correr SIEMPRE antes de subir cambios a .js/.css (hay un hook de pre-commit).
══════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const ignored = new Set(['node_modules', 'test', 'tools', 'sql', 'docs', 'Proyect', '.git']);
const files = fs.readdirSync(root, { withFileTypes: true })
  .filter(e => e.isFile())
  .map(e => e.name);
const code = files.filter(n => /\.(js|css)$/.test(n)).sort();
const pages = files.filter(n => /\.html$/.test(n));
const local = new Set(code);

const VERSION = /\?v=[0-9a-f]+/g;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const hash = crypto.createHash('sha1');
for (const name of code) hash.update(name + '\0' + read(name).replace(/\r\n/g, '\n').replace(VERSION, ''));
const version = hash.digest('hex').slice(0, 8);

/* Referencias locales: from './x.js', import './x.js', import('./x.js'), src="x.js", href="x.css" */
const rewriters = [
  [/((?:from|import)\s*\(?\s*['"])(\.\/[\w.-]+\.(?:js|css))(?:\?v=[0-9a-f]+)?(['"])/g, (m, a, file, c) => (local.has(file.slice(2)) ? `${a}${file}?v=${version}${c}` : m)],
  [/((?:src|href)=["'])([\w.-]+\.(?:js|css))(?:\?v=[0-9a-f]+)?(["'])/g, (m, a, file, c) => (local.has(file) ? `${a}${file}?v=${version}${c}` : m)],
];

let changed = 0;
for (const name of [...code, ...pages]) {
  if (ignored.has(name)) continue;
  const original = read(name);
  let text = original;
  for (const [pattern, fn] of rewriters) text = text.replace(pattern, fn);
  if (text !== original) {
    changed++;
    if (check) console.error(`desactualizado: ${name}`);
    else fs.writeFileSync(path.join(root, name), text);
  }
}

if (check) {
  if (changed) { console.error(`\n${changed} archivo(s) sin la versión ${version}. Ejecuta: node tools/stamp-version.mjs`); process.exit(1); }
  console.log(`versión ${version}: todo al día`);
} else {
  console.log(`versión ${version}: ${changed} archivo(s) actualizados`);
}
