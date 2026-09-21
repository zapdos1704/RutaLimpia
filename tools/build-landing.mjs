import { copyFile, cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
// Se limpia antes de copiar: si no, se acumulan los archivos con hash de compilaciones anteriores.
await rm(new URL('landing-assets/', root), { recursive: true, force: true });
await mkdir(new URL('landing-assets/', root), { recursive: true });
await cp(new URL('.landing-build/landing-assets/', root), new URL('landing-assets/', root), { recursive: true });
// La landing es la página de inicio del sitio (index.html). El login del panel vive en acceso.html.
await copyFile(new URL('.landing-build/index.html', root), new URL('index.html', root));
await copyFile(new URL('landing/assets/rutalimpia-logo.png', root), new URL('rutalimpia-logo.png', root));
const site = new URL('.site-build/', root);
await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && /\.(html|js|css|png|jpe?g|svg|webp|ico)$/.test(entry.name)) {
    await copyFile(new URL(entry.name, root), new URL(entry.name, site));
  }
}
await cp(new URL('.landing-build/landing-assets/', root), new URL('landing-assets/', site), { recursive: true });
await cp(new URL('Proyect/', root), new URL('Proyect/', site), { recursive: true });
console.log(`Landing lista: ${fileURLToPath(new URL('index.html', root))}`);
