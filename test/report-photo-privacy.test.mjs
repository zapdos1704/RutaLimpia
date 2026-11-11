import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../db.js', import.meta.url), 'utf8');
const functionText = source.match(/export async function getReports\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(functionText);
function loader(rows, signingFails = false) {
  const batches = [];
  const sb = {
    from: () => ({ select: () => ({ order: async () => ({ data: rows }) }) }),
    storage: { from: bucket => ({ createSignedUrls: async (paths, seconds) => {
      assert.equal(bucket, 'report-photos');
      assert.equal(seconds, 300);
      batches.push(paths);
      return signingFails ? { error: new Error('denied') } : {
        data: paths.map(path => ({ path, signedUrl: `https://storage.example/signed/${path}` }))
      };
    } }) }
  };
  const context = vm.createContext({ sb, URL, withTimeout: promise => promise, console: { error() {} } });
  vm.runInContext(functionText.replace('export ', '') + ';globalThis.load = getReports', context);
  return { run: () => context.load(), batches };
}

test('sólo firma fotos de la carpeta de su propietario y nunca conserva el enlace público', async () => {
  const rows = [
    { user_id: 'owner', photo_url: 'https://project.example/storage/v1/object/public/report-photos/owner/photo.jpg' },
    { user_id: 'owner', photo_url: 'other/photo.jpg' },
    { user_id: 'owner', photo_url: 'owner/../other/photo.jpg' },
    { user_id: 'owner', photo_url: 'https://external.example/image.jpg' },
    { user_id: 'owner', photo_url: 'owner/%2e%2e/photo.jpg' }
  ];
  const fixture = loader(rows);
  const result = await fixture.run();
  assert.equal(result[0].photo_url, 'https://storage.example/signed/owner/photo.jpg');
  assert.ok(result.slice(1).every(row => row.photo_url === null));
  assert.equal(fixture.batches.flat().length, 1);
});

test('si falla la firma, no recurre al enlace público anterior', async () => {
  const result = await loader([{ user_id: 'owner', photo_url: 'owner/photo.jpg' }], true).run();
  assert.equal(result[0].photo_url, null);
});

test('firma lotes de como máximo cien archivos y elimina duplicados', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ user_id: 'owner', photo_url: `owner/${i}.jpg` }));
  const fixture = loader([...rows, rows[0]]);
  const result = await fixture.run();
  assert.equal(result.length, 206);
  assert.equal(fixture.batches.length, 3);
  assert.equal(fixture.batches.flat().length, 205);
  assert.ok(fixture.batches.every(batch => batch.length <= 100));
});
