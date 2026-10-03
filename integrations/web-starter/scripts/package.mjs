import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const blocked = new Set(['state', 'cache', 'node_modules', 'dist', 'build', 'coverage']);

async function canonical(directory) {
  try { return await fs.realpath(directory); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(directory);
    if (parent === directory) throw error;
    return path.join(await canonical(parent), path.basename(directory));
  }
}

async function readInput(sourceDir, file) {
  let current = sourceDir;
  const segments = file.split('/');
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink()) throw new Error('Release input symlink rejected');
    if (index < segments.length - 1 ? !info.isDirectory() : !info.isFile()) {
      throw new Error('Release input must be a regular file');
    }
  }
  const handle = await fs.open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Release input must be a regular file');
    return await handle.readFile();
  } finally { await handle.close(); }
}

/** Build only explicitly approved files. outputDir must be a fresh directory outside sourceDir. */
export async function buildRelease({ sourceDir, outputDir, version }) {
  if (typeof sourceDir !== 'string' || typeof outputDir !== 'string' || !outputDir.trim()) {
    throw new Error('Source and output directories are required');
  }
  const source = path.resolve(sourceDir);
  const sourceInfo = await fs.lstat(source);
  if (sourceInfo.isSymbolicLink()) throw new Error('Release source symlink rejected');
  if (!sourceInfo.isDirectory()) throw new Error('Release source must be a directory');
  const canonicalSource = await fs.realpath(source);
  const output = path.resolve(outputDir);
  const canonicalOutput = await canonical(output);
  const relative = path.relative(canonicalSource, canonicalOutput);
  if (!relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error('Release output must be outside source directory');
  }
  try {
    await fs.lstat(output);
    throw new Error('Release output already exists; existing paths are never overwritten');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const pkg = JSON.parse(await readInput(source, 'package.json'));
  if (pkg.name !== 'openswitch-web-starter' || typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(pkg.version) ||
      (version !== undefined && version !== pkg.version)) throw new Error('Release version must match source package version');
  version = pkg.version;
  const files = JSON.parse(await readInput(source, 'release-files.json'));
  if (!Array.isArray(files) || files.length === 0 || new Set(files).size !== files.length ||
      !files.includes('package.json') || !files.includes('release-files.json') || files.some(file =>
        typeof file !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/u.test(file) ||
        file.split('/').some(segment => !segment || segment.startsWith('.') || blocked.has(segment)) ||
        file === 'RELEASE-MANIFEST.json')) throw new Error('Release allowlist contains unsafe or duplicate paths');
  // Validate and snapshot every input before creating any release path.
  const contents = new Map();
  for (const file of [...files].sort()) contents.set(file, await readInput(source, file));
  const name = `openswitch-web-starter-${version}`;
  const stageDir = path.join(output, name);
  const archivePath = path.join(output, `${name}.zip`);
  const metadataPath = path.join(output, 'release.json');
  const checksumPath = path.join(output, 'SHA256SUMS');
  await fs.mkdir(output, { mode: 0o700 });
  try {
    await fs.mkdir(stageDir, { mode: 0o700 });
    const inventory = {};
    for (const [file, bytes] of contents) {
      const target = path.join(stageDir, file);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o644 });
      inventory[file] = hash(bytes);
    }
    const manifest = { schemaVersion: 1, name: pkg.name, version, files: inventory };
    await fs.writeFile(path.join(stageDir, 'RELEASE-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
    // execFile passes literal arguments; no shell interpolation or recursive directory traversal.
    // A missing zip or nonzero exit rejects the build and removes only our fresh output.
    await run('zip', ['-q', '-X', archivePath, ...[...contents.keys(), 'RELEASE-MANIFEST.json'].map(file => `${name}/${file}`)], { cwd: output });
    const archiveSha256 = hash(await fs.readFile(archivePath));
    const metadata = {
      ...manifest, archive: path.basename(archivePath), archiveSha256,
      builtAt: new Date().toISOString(), buildRuntime: process.version,
      remoteSdkIncluded: false, remoteSdkPinnedByArchive: false,
      validation: 'See docs/validation.md; packaging does not certify a provider or deployed SDK.',
    };
    const metadataBytes = `${JSON.stringify(metadata, null, 2)}\n`;
    await fs.writeFile(metadataPath, metadataBytes, { flag: 'wx', mode: 0o644 });
    await fs.writeFile(checksumPath, `${archiveSha256}  ${name}.zip\n${hash(metadataBytes)}  release.json\n`, { flag: 'wx', mode: 0o644 });
    return { stageDir, archivePath, metadataPath, checksumPath };
  } catch (error) {
    await fs.rm(output, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('One fresh output directory is required');
    const release = await buildRelease({ sourceDir: fileURLToPath(new URL('..', import.meta.url)), outputDir: process.argv[2] });
    console.log(`Release created: ${release.archivePath}`);
  } catch {
    console.error('Release failed: use a fresh output directory outside source; verify allowlist, version, regular inputs and installed zip.');
    process.exitCode = 1;
  }
}
