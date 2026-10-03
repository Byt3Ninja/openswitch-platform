import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openswitch-package-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'source');
  await fs.mkdir(path.join(sourceDir, 'src'), { recursive: true });
  await fs.mkdir(path.join(sourceDir, 'test'), { recursive: true });
  const files = ['package.json', 'src/main.mjs', 'test/smoke.test.mjs', 'config.example.env', 'release-files.json'];
  await fs.writeFile(path.join(sourceDir, 'package.json'), JSON.stringify({ name: 'openswitch-web-starter', version: '0.1.0' }));
  await fs.writeFile(path.join(sourceDir, 'src/main.mjs'), 'console.log("dummy fixture");\n');
  await fs.writeFile(path.join(sourceDir, 'test/smoke.test.mjs'), '// dummy test fixture\n');
  await fs.writeFile(path.join(sourceDir, 'config.example.env'), 'MODE=demo\n');
  await fs.writeFile(path.join(sourceDir, 'release-files.json'), JSON.stringify(files));
  return { root, sourceDir, outputDir: path.join(root, 'release'), files };
}
async function builder() {
  // A missing implementation is an explicit assertion failure during the first red run.
  const module = await import('../scripts/package.mjs').catch(() => null);
  assert.equal(typeof module?.buildRelease, 'function', 'release builder must be implemented');
  return module.buildRelease;
}

// Catches accidentally copying an entire source directory rather than approved files.
test('archive and staging exclude environment, state and cache canaries', async t => {
  const f = await fixture(t);
  for (const [name, bytes] of [['.env', 'DUMMY_ENV_CANARY_829'], ['state/orders.json', 'DUMMY_STATE_CANARY_361'], ['node_modules/cache.bin', 'DUMMY_DEP_CANARY_172'], ['.cache/x', 'DUMMY_CACHE_CANARY_495']]) {
    await fs.mkdir(path.dirname(path.join(f.sourceDir, name)), { recursive: true });
    await fs.writeFile(path.join(f.sourceDir, name), bytes);
  }
  const release = await (await builder())({ ...f, version: '0.1.0' });
  assert.equal(path.basename(release.archivePath), 'openswitch-web-starter-0.1.0.zip');
  const unpack = path.join(f.root, 'unpack');
  execFileSync('unzip', ['-q', release.archivePath, '-d', unpack]);
  const manifest = JSON.parse(await fs.readFile(path.join(release.stageDir, 'RELEASE-MANIFEST.json')));
  assert.deepEqual(Object.keys(manifest.files).sort(), f.files.sort());
  for (const file of f.files) {
    const staged = await fs.readFile(path.join(release.stageDir, file));
    const archived = await fs.readFile(path.join(unpack, path.basename(release.stageDir), file));
    assert.equal(manifest.files[file], sha(staged));
    assert.deepEqual(archived, staged);
  }
  const listing = execFileSync('unzip', ['-Z1', release.archivePath], { encoding: 'utf8' });
  assert.doesNotMatch(listing, /\/(?:\.env(?:\n|\/)|state\/|node_modules\/|\.cache\/)/);
  for (const dir of [release.stageDir, path.join(unpack, path.basename(release.stageDir))]) {
    for (const name of ['.env', 'state', 'node_modules', '.cache']) await assert.rejects(fs.stat(path.join(dir, name)), { code: 'ENOENT' });
    const bytes = Buffer.concat(await Promise.all(f.files.map(file => fs.readFile(path.join(dir, file))))).toString();
    assert.doesNotMatch(bytes, /DUMMY_(ENV|STATE|DEP|CACHE)_CANARY/);
  }
  const metadata = JSON.parse(await fs.readFile(release.metadataPath));
  assert.equal(metadata.version, '0.1.0');
  assert.equal(metadata.archiveSha256, sha(await fs.readFile(release.archivePath)));
  for (const line of (await fs.readFile(release.checksumPath, 'utf8')).trim().split('\n')) {
    const [hash, filename] = line.split('  ');
    assert.equal(hash, sha(await fs.readFile(path.join(f.outputDir, filename))));
  }
});

// Catches destructive overwrite and path-containment mistakes, including symlink aliases.
test('existing outputs and source-contained output paths are rejected without overwrite', async t => {
  const f = await fixture(t);
  const buildRelease = await builder();
  await fs.mkdir(f.outputDir);
  await fs.writeFile(path.join(f.outputDir, 'sentinel'), 'PRESERVE_EXISTING_OUTPUT');
  await assert.rejects(buildRelease({ ...f, version: '0.1.0' }), /existing/i);
  assert.equal(await fs.readFile(path.join(f.outputDir, 'sentinel'), 'utf8'), 'PRESERVE_EXISTING_OUTPUT');
  await assert.rejects(buildRelease({ ...f, outputDir: path.join(f.sourceDir, 'release'), version: '0.1.0' }), /outside/i);
  await fs.symlink(f.sourceDir, path.join(f.root, 'alias'));
  await assert.rejects(buildRelease({ ...f, outputDir: path.join(f.root, 'alias', 'release'), version: '0.1.0' }), /outside|symlink/i);
});

// Catches following a symlink to unrelated private inputs, including intermediate directories.
test('symlink inputs fail closed before creating output', async t => {
  const f = await fixture(t);
  const buildRelease = await builder();
  await fs.writeFile(path.join(f.root, 'private-canary'), 'DUMMY_PRIVATE_CANARY_728');
  await fs.unlink(path.join(f.sourceDir, 'src/main.mjs'));
  await fs.symlink(path.join(f.root, 'private-canary'), path.join(f.sourceDir, 'src/main.mjs'));
  await assert.rejects(buildRelease({ ...f, version: '0.1.0' }), /symlink/i);
  await assert.rejects(fs.stat(f.outputDir), { code: 'ENOENT' });
  await fs.unlink(path.join(f.sourceDir, 'src/main.mjs'));
  await fs.rmdir(path.join(f.sourceDir, 'src'));
  await fs.mkdir(path.join(f.root, 'external'));
  await fs.writeFile(path.join(f.root, 'external/main.mjs'), 'DUMMY_PRIVATE_CANARY_728');
  await fs.symlink(path.join(f.root, 'external'), path.join(f.sourceDir, 'src'));
  await assert.rejects(buildRelease({ ...f, version: '0.1.0' }), /symlink/i);
});

// Catches mislabeled release bytes and archive filename injection.
test('requested release version must match the source version', async t => {
  const f = await fixture(t);
  const buildRelease = await builder();
  for (const version of ['0.2.0', '../unsafe', '0.1.0;anything']) {
    await assert.rejects(buildRelease({ ...f, version }), /version/i);
    await assert.rejects(fs.stat(f.outputDir), { code: 'ENOENT' });
  }
});

// Catches unsafe paths being deliberately added to the explicit manifest.
test('unsafe allowlist entries are rejected', async t => {
  const f = await fixture(t);
  const buildRelease = await builder();
  for (const file of ['../private', '/absolute', '.env', 'state/orders.json', 'node_modules/x', '.cache/x', 'src/../package.json']) {
    await fs.writeFile(path.join(f.sourceDir, 'release-files.json'), JSON.stringify([...f.files, file]));
    await assert.rejects(buildRelease({ ...f, version: '0.1.0' }), /allowlist/i);
    await assert.rejects(fs.stat(f.outputDir), { code: 'ENOENT' });
  }
});

// Catches reporting successful packaging when the external archive command fails.
test('archive command failure rejects and removes only the new release output', async t => {
  const f = await fixture(t);
  const zipDir = path.join(f.root, 'commands');
  await fs.mkdir(zipDir);
  await fs.writeFile(path.join(zipDir, 'zip'), '#!/bin/sh\nexit 19\n', { mode: 0o755 });
  const script = `import { buildRelease } from ${JSON.stringify(new URL('../scripts/package.mjs', import.meta.url).href)};
    await buildRelease(${JSON.stringify({ sourceDir: f.sourceDir, outputDir: f.outputDir, version: '0.1.0' })});`;
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, PATH: zipDir }, stdio: 'pipe',
  }));
  await assert.rejects(fs.stat(f.outputDir), { code: 'ENOENT' });
  assert.equal(JSON.parse(await fs.readFile(path.join(f.sourceDir, 'package.json'))).version, '0.1.0');
});
