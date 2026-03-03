import OpenAI from 'openai';
import { DEMO_AGENT_SYSTEM_PROMPT } from './prompts.js';
import { getPage } from '../electron/stagehand-manager.js';
import { writeSkillFromDemo } from '../skills/skill-writer.js';
import { pushStatus } from '../electron/status-bus.js';

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/your-org/universal-agent',
    'X-Title': 'Universal Agent'
  }
});

const state = {
  active: false,
  pendingVoice: [],
  currentSkillDraft: null,
  lastObserveResult: null,
  observeTimer: null,
  page: null,
  listenersInstalled: false,
  awaitingConfirmation: null,
  observeFallbackLogged: false
};

function isConfirming(text) {
  return /\b(yes|yep|ok|okay|that'?s right|correct|looks good|save it)\b/i.test(text);
}

function normalizeDomain(urlString) {
  try {
    return new URL(urlString).hostname;
  } catch {
    return 'unknown.local';
  }
}

function scheduleObserve(reason) {
  if (!state.active) return;
  clearTimeout(state.observeTimer);
  state.observeTimer = setTimeout(() => {
    fireObserve(reason).catch((error) => pushStatus(`Observe failed: ${error.message}`, 'error'));
  }, 600);
}

async function installPageListeners(page) {
  if (state.listenersInstalled) return;

  const attach = (eventName, handler, onUnsupportedMessage) => {
    try {
      page.on(eventName, handler);
      return true;
    } catch (error) {
      const message = String(error?.message || error);
      if (/Unsupported event/i.test(message)) {
        pushStatus(onUnsupportedMessage, 'warning');
        return false;
      }
      throw error;
    }
  };

  // Some Stagehand page wrappers do not expose Playwright 'request' events.
  // Verified via runtime logs: fallback to navigation + DOM mutation observers when unsupported.
  attach(
    'request',
    (request) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
        scheduleObserve('network:mutation');
      }
    },
    'Network mutation listener unavailable on this page wrapper; using navigation + DOM signals.'
  );

  attach(
    'framenavigated',
    (frame) => {
      if (frame === page.mainFrame()) scheduleObserve('navigation');
    },
    'Frame navigation listener unavailable on this page wrapper; using DOM signals.'
  );

  if (typeof page.exposeFunction === 'function') {
    await page
      .exposeFunction('__ua_domChange', (info) => {
        scheduleObserve(`dom:${info}`);
      })
      .catch(() => {});
  } else {
    pushStatus('DOM bridge unavailable on this page wrapper; relying on voice-triggered observe.', 'warning');
  }

  if (typeof page.evaluate === 'function') {
    await page
      .evaluate(() => {
        if (window.__uaMutationObserverInstalled) return;
        window.__uaMutationObserverInstalled = true;
        const observer = new MutationObserver((mutations) => {
          const additions = mutations.reduce((total, mutation) => {
            return (
              total +
              Array.from(mutation.addedNodes).filter((node) => node.nodeType === Node.ELEMENT_NODE).length
            );
          }, 0);
          if (additions > 0 && typeof window.__ua_domChange === 'function') {
            window.__ua_domChange(`${additions}_nodes_added`);
          }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        window.__uaMutationObserver = observer;
      })
      .catch(() => {});
  }

  state.listenersInstalled = true;
}

async function removePageListeners() {
  if (!state.page) return;

  clearTimeout(state.observeTimer);
  state.observeTimer = null;

  for (const eventName of ['request', 'framenavigated', 'pageerror']) {
    try {
      state.page.removeAllListeners(eventName);
    } catch {}
  }

  if (typeof state.page.evaluate === 'function') {
    await state.page
      .evaluate(() => {
        if (window.__uaMutationObserver) {
          window.__uaMutationObserver.disconnect();
          delete window.__uaMutationObserver;
          delete window.__uaMutationObserverInstalled;
        }
      })
      .catch(() => {});
  }

  state.listenersInstalled = false;
}

async function fireObserve(reason) {
  const page = state.page || (await getPage());

  if (typeof page.waitForLoadState === 'function') {
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }
  let observed = [];

  if (typeof page.observe === 'function') {
    // Verified via web: Stagehand observe() is invoked on page with natural-language instruction and optional iframes flag.
    observed = await page
      .observe('List visible interactive elements and what action each enables.', { iframes: true })
      .catch((error) => {
        pushStatus(`Observe API failed; falling back to DOM scan (${String(error?.message || error)}).`, 'warning');
        return [];
      });
  } else if (typeof page.evaluate === 'function') {
    if (!state.observeFallbackLogged) {
      pushStatus('Observe API unavailable on page wrapper; using DOM interactive-element scan fallback.', 'warning');
      state.observeFallbackLogged = true;
    }

    observed = await page
      .evaluate(() => {
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
          .slice(0, 25);
      })
      .catch(() => []);
  }

  state.lastObserveResult = {
    reason,
    observedElements: Array.isArray(observed) ? observed : [],
    timestamp: Date.now()
  };

  pushStatus(`Observed ${state.lastObserveResult.observedElements.length} elements (${reason}).`, 'status');
}

async function runDemoAgent({ voiceSegments, observedElements, currentDraft, pageUrl, correction }) {
  const domain = normalizeDomain(pageUrl);
  const voiceContext = voiceSegments.map((segment) => `- ${segment.transcript}`).join('\n') || '- (none)';
  const observedContext = observedElements.length
    ? observedElements
        .slice(0, 20)
        .map((element, index) => {
          const label = element?.description || element?.text || JSON.stringify(element);
          const method = element?.method || 'act';
          return `${index + 1}. "${label}" [${method}]`;
        })
        .join('\n')
    : '(No observed interactive elements.)';

  pushStatus(`OpenRouter request started for demo synthesis (model=${process.env.DEMO_MODEL || 'google/gemini-2.5-flash'}).`, 'api');
  const completion = await openrouter.chat.completions.create({
    model: process.env.DEMO_MODEL || 'google/gemini-2.5-flash',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: DEMO_AGENT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Site: ${domain}\nPage URL: ${pageUrl}\nVoice:\n${voiceContext}\n\nObserved elements:\n${observedContext}\n\nCurrent draft:\n${
          currentDraft || '(none)'
        }\n\nCorrection from user: ${correction || '(none)'}`
      }
    ]
  });
  pushStatus('OpenRouter demo synthesis response received.', 'api');

  const payload = completion.choices[0]?.message?.content || '{}';
  return JSON.parse(payload);
}

async function handleConfirmationTranscript(transcript) {
  const pending = state.awaitingConfirmation;
  if (!pending) return null;

  if (isConfirming(transcript)) {
    return saveCurrentPendingSkill();
  }

  const revised = await runDemoAgent({
    voiceSegments: [{ transcript, timestamp: Date.now() }],
    observedElements: state.lastObserveResult?.observedElements || [],
    currentDraft: pending.finalSkill,
    pageUrl: state.page?.url() || 'https://example.com',
    correction: transcript
  });

  if (revised.updatedDraft) state.currentSkillDraft = revised.updatedDraft;
  if (revised.skillComplete) {
    state.awaitingConfirmation = {
      finalSkill: revised.finalSkill,
      skillName: revised.skillName,
      domain: normalizeDomain(state.page?.url() || 'https://example.com')
    };
  }

  return {
    agentMessage: revised.message || 'Updated draft based on your correction. Confirm when ready.',
    skillWritten: null,
    awaitingConfirmation: Boolean(state.awaitingConfirmation)
  };
}

async function saveCurrentPendingSkill() {
  const pending = state.awaitingConfirmation;
  if (!pending) {
    return {
      agentMessage: 'I still need to finalize the draft before saving. Continue review first.',
      skillWritten: null,
      awaitingConfirmation: false
    };
  }

  const saved = await writeSkillFromDemo({
    domain: pending.domain,
    skillName: pending.skillName,
    finalSkill: pending.finalSkill
  });

  state.awaitingConfirmation = null;
  state.currentSkillDraft = null;
  state.pendingVoice = [];

  pushStatus(`Skill saved: ${saved.domain}/${saved.filename}`, 'status');
  return {
    agentMessage: `Saved '${pending.skillName}' for ${pending.domain}.`,
    skillWritten: saved,
    awaitingConfirmation: false
  };
}

export async function startDemoSession() {
  state.active = true;
  state.pendingVoice = [];
  state.currentSkillDraft = null;
  state.lastObserveResult = null;
  state.awaitingConfirmation = null;
  state.observeFallbackLogged = false;
  state.page = await getPage();

  const currentUrl = typeof state.page?.url === 'function' ? state.page.url() : '';
  const isBlankPage = !currentUrl || currentUrl === 'about:blank';
  if (isBlankPage) {
    state.active = false;
    throw new Error(
      'Demo mode cannot start on about:blank. Open a website in the agent browser first.'
    );
  }

  await installPageListeners(state.page);
  pushStatus('Demo mode active. Narrate your actions while demonstrating in Chrome.', 'status');
}

export async function endDemoSession() {
  const hadActiveSession =
    state.active ||
    state.listenersInstalled ||
    state.pendingVoice.length > 0 ||
    Boolean(state.currentSkillDraft);

  state.active = false;
  await removePageListeners();

  const summary = {
    hadDraft: Boolean(state.currentSkillDraft),
    lastObserveReason: state.lastObserveResult?.reason || null,
    pendingVoiceCount: state.pendingVoice.length
  };

  state.pendingVoice = [];
  state.currentSkillDraft = null;
  state.lastObserveResult = null;
  state.awaitingConfirmation = null;
  state.observeFallbackLogged = false;
  state.page = null;
  if (hadActiveSession) pushStatus('Demo mode ended.', 'status');

  return summary;
}

export async function handleVoiceSegment(transcript) {
  if (!state.active) {
    return { agentMessage: 'Demo mode is not active.', skillWritten: null, awaitingConfirmation: false };
  }

  if (state.awaitingConfirmation) {
    const confirmationResult = await handleConfirmationTranscript(transcript);
    if (confirmationResult) return confirmationResult;
  }

  const now = Date.now();
  state.pendingVoice.push({ transcript, timestamp: now });

  if (!state.lastObserveResult || now - state.lastObserveResult.timestamp > 3000) {
    await fireObserve('voice-triggered');
  }

  const agentResponse = await runDemoAgent({
    voiceSegments: state.pendingVoice,
    observedElements: state.lastObserveResult?.observedElements || [],
    currentDraft: state.currentSkillDraft,
    pageUrl: state.page?.url() || 'https://example.com'
  });

  if (agentResponse.updatedDraft) {
    state.currentSkillDraft = agentResponse.updatedDraft;
  }

  if (agentResponse.skillComplete && agentResponse.finalSkill) {
    state.awaitingConfirmation = {
      finalSkill: agentResponse.finalSkill,
      skillName: agentResponse.skillName || 'new-skill',
      domain: normalizeDomain(state.page?.url() || 'https://example.com')
    };

    return {
      agentMessage:
        agentResponse.message ||
        `I have a complete draft for '${state.awaitingConfirmation.skillName}'. Confirm to save.`,
      skillWritten: null,
      awaitingConfirmation: true
    };
  }

  return {
    agentMessage: agentResponse.message || 'Captured. Continue demonstrating or refine the draft.',
    skillWritten: null,
    awaitingConfirmation: false
  };
}

export async function finalizeDemoCaptureForReview() {
  if (!state.active) {
    return {
      agentMessage: 'Demo mode is not active.',
      skillWritten: null,
      awaitingConfirmation: false
    };
  }

  if (state.awaitingConfirmation) {
    return {
      agentMessage: `I have a complete draft for '${state.awaitingConfirmation.skillName}'. Click Create Skill to save, or reply with corrections.`,
      skillWritten: null,
      awaitingConfirmation: true
    };
  }

  if (!state.pendingVoice.length && !state.currentSkillDraft) {
    return {
      agentMessage: 'No narration captured yet. Start narrating before ending demo.',
      skillWritten: null,
      awaitingConfirmation: false
    };
  }

  if (!state.lastObserveResult || Date.now() - state.lastObserveResult.timestamp > 3000) {
    await fireObserve('review-start');
  }

  const reviewSegments = state.pendingVoice.length
    ? state.pendingVoice
    : [{ transcript: 'User ended demo capture and wants to finalize the skill.', timestamp: Date.now() }];

  const agentResponse = await runDemoAgent({
    voiceSegments: reviewSegments,
    observedElements: state.lastObserveResult?.observedElements || [],
    currentDraft: state.currentSkillDraft,
    pageUrl: state.page?.url() || 'https://example.com',
    correction:
      'User ended demo capture and entered review. Ask one concise clarifying question if needed, otherwise finalize.'
  });

  if (agentResponse.updatedDraft) {
    state.currentSkillDraft = agentResponse.updatedDraft;
  }

  if (agentResponse.skillComplete && agentResponse.finalSkill) {
    state.awaitingConfirmation = {
      finalSkill: agentResponse.finalSkill,
      skillName: agentResponse.skillName || 'new-skill',
      domain: normalizeDomain(state.page?.url() || 'https://example.com')
    };
    return {
      agentMessage:
        agentResponse.message ||
        `I have a complete draft for '${state.awaitingConfirmation.skillName}'. Click Create Skill to save, or reply with corrections.`,
      skillWritten: null,
      awaitingConfirmation: true
    };
  }

  return {
    agentMessage:
      agentResponse.message ||
      'I need one more clarification before I can finalize the skill. Reply with the missing detail.',
    skillWritten: null,
    awaitingConfirmation: false
  };
}

export async function saveDraftFromReview() {
  return saveCurrentPendingSkill();
}
