import os from 'node:os';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** @typedef {{id: string, label: string, amount: number, currency: string}} CatalogItem */
/**
 * @typedef {object} Config
 * @property {'demo'|'sandbox'} mode
 * @property {number} port
 * @property {string} apiBaseUrl
 * @property {string} sdkUrl
 * @property {string|undefined} apiKey
 * @property {string|undefined} publishableKey
 * @property {string|undefined} profileId
 * @property {string} localOrigin
 * @property {string} returnUrl
 * @property {string} stateDir
 * @property {number} timeoutMs
 * @property {CatalogItem[]} catalog
 */

const sourceDir = realpathSync(fileURLToPath(new URL('..', import.meta.url)));

function required(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required for confirmed sandbox mode`);
  }
  return value;
}

function httpsUrl(value, name, originOnly = false) {
  let url;
  try {
    if (typeof value !== 'string' || /\s|\\|[?#]/u.test(value)) throw new Error();
    url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error();
    if (originOnly && url.pathname !== '/') throw new Error();
  } catch {
    // Never put rejected URL values (which may contain credentials) in errors.
    throw new Error(`${name} must be an HTTPS ${originOnly ? 'origin' : 'URL'} without credentials, query or fragment`);
  }
  return originOnly ? url.origin : url.href;
}

function canonicalPath(directory) {
  try {
    return realpathSync(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(directory);
    if (parent === directory) throw error;
    return path.join(canonicalPath(parent), path.basename(directory));
  }
}

function stateDirectory(value) {
  try {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error();
    const directory = canonicalPath(path.resolve(value));
    const relative = path.relative(sourceDir, directory);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error();
    }
    return directory;
  } catch {
    throw new Error('STATE_DIR must be an absolute path resolving outside the packaged source directory');
  }
}

function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) throw new Error('Catalog must contain at least one product');
  const ids = new Set();
  return catalog.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(item.id) || ids.has(item.id)) {
      throw new Error('Catalog product IDs must be unique and contain only letters, numbers, underscore or hyphen');
    }
    if (typeof item.label !== 'string' || !item.label.trim()) throw new Error('Catalog products require a label');
    if (!Number.isSafeInteger(item.amount) || item.amount <= 0) throw new Error('Catalog amounts must be positive safe integers in minor units');
    if (typeof item.currency !== 'string' || !/^[A-Z]{3}$/u.test(item.currency)) throw new Error('Catalog currencies must contain three uppercase letters');
    ids.add(item.id);
    return { id: item.id, label: item.label, amount: item.amount, currency: item.currency };
  });
}

/** Validate startup inputs without loading files or making network calls. @returns {Config} */
export function loadConfig(env, catalog) {
  const mode = env.MODE ?? 'demo';
  if (mode !== 'demo' && mode !== 'sandbox') throw new Error('MODE must be demo or sandbox; live mode is unavailable');
  if (mode === 'sandbox') {
    for (const key of ['API_KEY', 'PUBLISHABLE_KEY', 'PROFILE_ID', 'STATE_DIR']) required(env, key);
    if (env.SANDBOX_CONFIRMED !== 'yes') throw new Error('SANDBOX_CONFIRMED=yes requires administrator verification of test mode, endpoint, routing and credentials');
  }
  const portValue = env.PORT ?? '4242';
  const port = Number(portValue);
  if (!/^[0-9]+$/u.test(String(portValue)) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const localOrigin = new URL(`http://127.0.0.1:${port}`).origin;
  if (env.LOCAL_ORIGIN !== undefined && env.LOCAL_ORIGIN !== localOrigin) {
    throw new Error('LOCAL_ORIGIN must be the HTTP 127.0.0.1 origin matching PORT');
  }
  if (env.RETURN_URL !== undefined) throw new Error('RETURN_URL cannot be configured; it is derived from LOCAL_ORIGIN');
  return {
    mode,
    port,
    apiBaseUrl: httpsUrl(env.API_BASE_URL ?? 'https://api.openswitch.io', 'API_BASE_URL', true),
    sdkUrl: httpsUrl(env.SDK_URL ?? 'https://sdk.openswitch.io/HyperLoader.js', 'SDK_URL'),
    apiKey: env.API_KEY,
    publishableKey: env.PUBLISHABLE_KEY,
    profileId: env.PROFILE_ID,
    localOrigin,
    returnUrl: `${localOrigin}/return`,
    stateDir: stateDirectory(env.STATE_DIR ?? path.join(os.tmpdir(), 'openswitch-web-starter-demo')),
    timeoutMs: 10_000,
    catalog: validateCatalog(catalog),
  };
}

/** Browser-facing allowlist; never spread the private configuration. */
export function publicConfig(config) {
  return {
    mode: config.mode,
    apiBaseUrl: config.apiBaseUrl,
    sdkUrl: config.sdkUrl,
    publishableKey: config.publishableKey,
    localOrigin: config.localOrigin,
    catalog: config.catalog,
  };
}
