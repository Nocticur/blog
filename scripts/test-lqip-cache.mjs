import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const script = path.resolve('scripts/generate-lqips.ts');
test('replacing an image at the same path regenerates its placeholder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blog-lqip-test-'));
  try {
    await fs.mkdir(path.join(root, 'public'), { recursive: true });
    const image = path.join(root, 'public/cover.png');
    const run = () => execFileSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, script], { cwd: root, stdio: 'pipe' });
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } }).png().toFile(image);
    run();
    const first = JSON.parse(await fs.readFile(path.join(root, 'src/constants/lqips.json')));
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#0000ff' } }).png().toFile(image);
    run();
    const second = JSON.parse(await fs.readFile(path.join(root, 'src/constants/lqips.json')));
    assert.notEqual(first['public:cover.png'], second['public:cover.png']);
    await fs.unlink(image); run();
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'src/constants/lqips.json'))), {});
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
