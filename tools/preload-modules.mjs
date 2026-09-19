#!/usr/bin/env node
/* ══════════════════════════════════════════════════════
   tools/preload-modules.mjs
   Escribe en el <head> de cada página un bloque con:
     · preconnect a los servidores que usa (CDN, Supabase, mapas, fuentes);
     · modulepreload de TODOS los módulos que la página importa, incluidos los
       que importan otros módulos.
   Sin esto el navegador descubre los módulos en cascada (HTML → módulo → módulo →
   CDN) y cada nivel espera al anterior; con el bloque los pide todos a la vez.

   El bloque va entre marcadores y se regenera solo. Correr antes de
   stamp-version.mjs.
══════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- rl-hints:start -->';
const END = '<!-- rl-hints:end -->';
const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
/* Dependencias que importa esa entrada (versiones fijadas por supabase-js@2.116.0). */
const SUPABASE_DEPS = [
  '@supabase/functions-js@2.116.0', '@supabase/realtime-js@2.116.0', '@supabase/postgrest-js@2.116.0',
  '@supabase/storage-js@2.116.0', '@supabase/auth-js@2.116.0', 'tslib@2.8.1', '@supabase/phoenix@0.4.5', 'iceberg-js@0.8.1',
].map(name => `https://cdn.jsdelivr.net/npm/${name}/+esm`);
const MAPTILER_STYLE = /https:\/\/api\.maptiler\.com\/maps\/[\w-]+\/style\.json\?key=[\w]+/;

const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const localImports = text => [...text.matchAll(/(?:from|import)\s*\(?\s*['"]\.\/([\w.-]+\.js)(?:\?v=[0-9a-f]+)?['"]/g)].map(m => m[1]);

function closure(entry) {
  const seen = new Set();
  const visit = name => {
    if (seen.has(name) || !fs.existsSync(path.join(root, name))) return;
    seen.add(name);
    localImports(read(name)).forEach(visit);
  };
  entry.forEach(visit);
  return [...seen];
}

let touched = 0;
for (const page of fs.readdirSync(root).filter(n => n.endsWith('.html'))) {
  let html = read(page).replace(/\r\n/g, '\n');
  const crlf = read(page).includes('\r\n');
  html = html.replace(new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`), '\n');

  const modules = closure(localImports(html));
  if (!modules.length) { if (read(page) !== (crlf ? html.replace(/\n/g, '\r\n') : html)) fs.writeFileSync(path.join(root, page), crlf ? html.replace(/\n/g, '\r\n') : html); continue; }

  const lines = [START];
  const origins = new Set();
  if (modules.includes('db.js')) { origins.add('https://cdn.jsdelivr.net'); origins.add('https://psbxfrwcubgwmycztiqu.supabase.co'); }
  if (/cdn\.jsdelivr\.net/.test(html)) origins.add('https://cdn.jsdelivr.net');
  if (/api\.maptiler\.com/.test(html)) origins.add('https://api.maptiler.com');
  if (/fonts\.googleapis\.com/.test(html)) { origins.add('https://fonts.googleapis.com'); origins.add('https://fonts.gstatic.com'); }
  for (const o of origins) lines.push(`<link rel="preconnect" href="${o}"${/gstatic|jsdelivr|maptiler|supabase/.test(o) ? ' crossorigin' : ''}/>`);
  for (const m of modules) lines.push(`<link rel="modulepreload" href="${m}"/>`);
  if (modules.includes('db.js')) for (const url of [SUPABASE_ESM, ...SUPABASE_DEPS]) lines.push(`<link rel="modulepreload" href="${url}"/>`);
  const style = html.match(MAPTILER_STYLE);
  if (style) lines.push(`<link rel="preload" as="fetch" href="${style[0]}" crossorigin/>`);
  lines.push(END);

  const at = html.indexOf('</head>');
  if (at < 0) continue;
  html = html.slice(0, at) + lines.join('\n') + '\n' + html.slice(at);
  fs.writeFileSync(path.join(root, page), crlf ? html.replace(/\n/g, '\r\n') : html);
  touched++;
  console.log(`${page}: ${modules.length} módulos, ${origins.size} orígenes`);
}
console.log(`${touched} página(s) con bloque de precarga`);
