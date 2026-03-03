import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Stagehand, AISdkClient } from '@browserbasehq/stagehand';
import { createOpenAI } from '@ai-sdk/openai';

let stagehand = null;
const DEFAULT_START_URL = process.env.START_URL || 'https://www.google.com';
const DEFAULT_STAGEHAND_MODEL = 'google/gemini-2.5-flash';

export class ChromeNotFoundError extends Error {
  constructor(pathsSearched) {
    super(
      `Chrome not found. Install Google Chrome and restart Universal Agent. Searched: ${pathsSearched.join(', ')}`
    );
    this.name = 'ChromeNotFoundError';
  }
}

function buildChromeCandidates() {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ];
  }

  if (process.platform === 'win32') {
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA;
    const candidates = [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    if (local) candidates.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    return candidates;
  }

  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
}

export function getChromePath() {
  const candidates = buildChromeCandidates();
  const found = candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

  if (!found) throw new ChromeNotFoundError(candidates);
  return found;
}

function buildOpenRouterClient() {
  const configuredModel = String(process.env.STAGEHAND_MODEL || DEFAULT_STAGEHAND_MODEL).trim();
  const normalizedModel = normalizeOpenRouterModel(configuredModel);
  if (normalizedModel !== configuredModel) {
    // Keep execution model IDs canonical for OpenRouter (provider/model).
    // Example: openai/google/gemini-2.5-flash -> google/gemini-2.5-flash
    console.warn(
      `[stagehand] Normalized STAGEHAND_MODEL from "${configuredModel}" to "${normalizedModel}" for OpenRouter compatibility.`
    );
  }
  const provider = createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/your-org/universal-agent',
      'X-Title': 'Universal Agent'
    }
  });

  // Verified via web: Stagehand v3 docs show AISdkClient + OpenAI-compatible providers work for LOCAL observe/act.
  return new AISdkClient({
    model: provider(normalizedModel)
  });
}

function normalizeOpenRouterModel(modelName) {
  const trimmed = String(modelName || '').trim();
  if (!trimmed) return DEFAULT_STAGEHAND_MODEL;

  const parts = trimmed.split('/');
  if (parts.length >= 3 && parts[0] === 'openai') {
    return parts.slice(1).join('/');
  }
  return trimmed;
}

export async function getStagehand() {
  if (stagehand) return stagehand;

  stagehand = new Stagehand({
    env: 'LOCAL',
    experimental: true,
    disableAPI: true,
    localBrowserLaunchOptions: {
      headless: false,
      executablePath: getChromePath(),
      args: []
    },
    llmClient: buildOpenRouterClient(),
    verbose: 0,
    enableCaching: true
  });

  await stagehand.init();

  try {
    const page = await getPage();
    const currentUrl = typeof page.url === 'function' ? page.url() : '';
    const isBlank = !currentUrl || currentUrl === 'about:blank';
    if (isBlank && typeof page.goto === 'function') {
      // Verified via web: Stagehand LOCAL mode exposes Playwright-compatible goto() on page.
      await page.goto(DEFAULT_START_URL, { waitUntil: 'domcontentloaded' });
    }
  } catch {
    // Non-fatal: demo/work flows can still navigate later.
  }

  return stagehand;
}

export async function getPage() {
  const sh = await getStagehand();
  if (typeof sh.page !== 'undefined') return sh.page;

  // Verified via web: Stagehand v3 docs expose context.waitForPage()/pages() access patterns in LOCAL mode.
  if (sh.context?.pages?.().length) return sh.context.pages()[0];
  if (sh.context?.waitForEvent) return sh.context.waitForEvent('page');
  throw new Error('No browser page is available from Stagehand context.');
}

export async function navigateTo(url) {
  const page = await getPage();
  if (page.url() !== url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  return page;
}

export async function closeStagehand() {
  if (!stagehand) return;
  try {
    await stagehand.close();
  } finally {
    stagehand = null;
  }
}
