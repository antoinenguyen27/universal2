import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Stagehand } from '@browserbasehq/stagehand';

let stagehand = null;
const DEFAULT_START_URL = process.env.START_URL || 'https://www.google.com';
const EXECUTION_MODEL = 'anthropic/claude-haiku-4-5-20251001';

export class ChromeNotFoundError extends Error {
  constructor(pathsSearched) {
    super(
      `Chrome not found. Install Google Chrome and restart Universal. Searched: ${pathsSearched.join(', ')}`
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

function requireAnthropicKey() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'Missing ANTHROPIC_API_KEY. Hybrid execution requires Anthropic credentials.'
    );
  }
}

export async function getStagehand() {
  if (stagehand) return stagehand;
  requireAnthropicKey();

  stagehand = new Stagehand({
    env: 'LOCAL',
    experimental: true,
    disableAPI: true,
    model: EXECUTION_MODEL,
    localBrowserLaunchOptions: {
      headless: false,
      executablePath: getChromePath(),
      args: []
    },
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
