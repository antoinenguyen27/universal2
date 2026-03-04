import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '../.env');

const SUPPORTED_ENV_KEYS = [
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'STAGEHAND_AGENT_MODE',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'DEBUG_MODE'
];
const EXECUTION_MODES = ['dom', 'cua', 'hybrid'];

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const idx = line.indexOf('=');
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1);
  return { key, value };
}

function readBooleanEnv(value, fallback = false) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function envValue(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r?\n/g, '').trim();
}

function quoteEnvValue(value) {
  if (!value) return '';
  if (/\s|#|=/.test(value)) return JSON.stringify(value);
  return value;
}

export function normalizeExecutionMode(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return EXECUTION_MODES.includes(normalized) ? normalized : 'cua';
}

export function getRuntimeSettings() {
  return {
    openrouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    executionMode: normalizeExecutionMode(process.env.STAGEHAND_AGENT_MODE),
    elevenlabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
    elevenlabsVoiceConfigured: Boolean(process.env.ELEVENLABS_VOICE_ID),
    debugMode: readBooleanEnv(process.env.DEBUG_MODE, false)
  };
}

export async function persistEnvPatch(patch = {}) {
  const normalized = {};
  for (const key of SUPPORTED_ENV_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    if (key === 'DEBUG_MODE') {
      normalized[key] = patch[key] ? 'true' : '';
      continue;
    }
    if (key === 'STAGEHAND_AGENT_MODE') {
      normalized[key] = normalizeExecutionMode(patch[key]);
      continue;
    }
    normalized[key] = envValue(String(patch[key] ?? ''));
  }

  let text = '';
  try {
    text = await fs.readFile(ENV_PATH, 'utf8');
  } catch {
    text = '';
  }

  const lines = text.length ? text.split(/\r?\n/) : [];
  const seen = new Set();
  const updated = lines.map((line) => {
    const parsed = parseLine(line);
    if (!parsed || !Object.prototype.hasOwnProperty.call(normalized, parsed.key)) return line;
    seen.add(parsed.key);
    const nextValue = normalized[parsed.key];
    if (!nextValue) return '';
    return `${parsed.key}=${quoteEnvValue(nextValue)}`;
  });

  for (const [key, value] of Object.entries(normalized)) {
    if (seen.has(key) || !value) continue;
    updated.push(`${key}=${quoteEnvValue(value)}`);
  }

  const finalContent = `${updated.filter(Boolean).join('\n')}\n`;
  await fs.writeFile(ENV_PATH, finalContent, 'utf8');

  for (const [key, value] of Object.entries(normalized)) {
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
}
