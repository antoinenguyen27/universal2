import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getPage, getStagehand } from '../../../electron/stagehand-manager.js';
import { pushStatus } from '../../../electron/status-bus.js';

function normalizeObservedElements(observed) {
  if (!Array.isArray(observed)) return [];
  return observed
    .map((item) => {
      const description =
        item?.description ||
        item?.text ||
        item?.label ||
        item?.instruction ||
        item?.action ||
        String(item || '');
      const method = item?.method || item?.type || 'act';
      if (!description) return null;
      return { description: String(description), method: String(method) };
    })
    .filter(Boolean);
}

function isWeakObservedContext(observedElements = []) {
  if (!Array.isArray(observedElements) || observedElements.length < 3) return true;
  const generic = new Set(['button', 'input', 'select', 'textarea', 'link', 'a', 'div', 'span']);
  const informative = observedElements.filter((element) => {
    const description = String(element?.description || element?.text || '')
      .trim()
      .toLowerCase();
    if (!description) return false;
    if (generic.has(description)) return false;
    return description.length > 2;
  });
  return informative.length < 3;
}

async function fallbackDomObserve(page, limit = 25) {
  if (typeof page.evaluate !== 'function') return [];
  return page
    .evaluate((innerLimit) => {
      const selectors = [
        'a[href]',
        'button',
        'input:not([type="hidden"])',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[tabindex]'
      ];
      const nodes = Array.from(document.querySelectorAll(selectors.join(',')));
      const seen = new Set();
      return nodes
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        })
        .map((node) => {
          const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          const aria = (node.getAttribute('aria-label') || '').trim();
          const placeholder = (node.getAttribute('placeholder') || '').trim();
          const title = (node.getAttribute('title') || '').trim();
          const description = text || aria || placeholder || title || node.tagName.toLowerCase();
          const key = `${node.tagName}|${description}`;
          if (seen.has(key)) return null;
          seen.add(key);
          return { description, method: 'act' };
        })
        .filter(Boolean)
        .slice(0, innerLimit);
    }, limit)
    .catch(() => []);
}

function toRelativeMs(epochMs, timelineStartEpochMs) {
  if (!Number.isFinite(epochMs) || !Number.isFinite(timelineStartEpochMs) || timelineStartEpochMs <= 0) {
    return null;
  }
  return Math.max(0, Math.round(epochMs - timelineStartEpochMs));
}

export async function runObservePage({ reason = 'manual', limit = 25, timelineStartEpochMs = 0 } = {}) {
  const page = await getPage();
  const sh = await getStagehand();
  const pageUrl = typeof page.url === 'function' ? page.url() : 'https://example.com';

  if (typeof page.waitForLoadState === 'function') {
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  let observeSource = 'stagehand';
  let observed = await sh
    .observe('List visible interactive elements and what action each enables.')
    .then((result) => normalizeObservedElements(result))
    .catch((error) => {
      pushStatus(`Stagehand observe failed; using DOM fallback (${String(error?.message || error)}).`, 'warning');
      return [];
    });

  if (!observed.length) {
    observeSource = 'dom-fallback';
    observed = await fallbackDomObserve(page, limit);
  }

  const trimmed = observed.slice(0, Math.max(1, Math.min(limit, 50)));
  const weakContext = isWeakObservedContext(trimmed);
  const observedAtMs = toRelativeMs(Date.now(), Number(timelineStartEpochMs));

  pushStatus(`Observed ${trimmed.length} elements (reason=${reason}, source=${observeSource}).`, 'status');

  return {
    url: pageUrl,
    observedAtMs,
    observedElements: trimmed,
    source: observeSource,
    weakContext
  };
}

export const observePageTool = tool(
  async ({ reason, limit }) => {
    return runObservePage({ reason, limit });
  },
  {
    name: 'observe_page',
    description: 'Observe visible interactive elements on the current browser page.',
    schema: z.object({
      reason: z.string().default('tool-request').describe('Why this observation was requested.'),
      limit: z.number().int().min(1).max(50).optional().describe('Maximum interactive elements to return.')
    })
  }
);
