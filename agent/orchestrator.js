import OpenAI from 'openai';
import { buildOrchestratorPrompt } from './prompts.js';
import { executeCUAInstruction, pauseCUA } from './work-agent.js';
import { loadSkillsForSite } from '../skills/skill-store.js';
import { addToMemory, getSessionMemory } from '../memory/session-memory.js';
import { getPage } from '../electron/stagehand-manager.js';
import { pushStatus } from '../electron/status-bus.js';

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/your-org/universal-agent',
    'X-Title': 'Universal Agent'
  }
});

let pendingIrreversibleDecision = null;
const API_LOG_MAX_CHARS = 4000;

function isAffirmative(text) {
  return /\b(yes|yep|ok|okay|confirm|do it|go ahead|that'?s right|correct)\b/i.test(text);
}

function isNegative(text) {
  return /\b(no|cancel|stop|don'?t|do not|wait)\b/i.test(text);
}

function isIrreversible(text = '') {
  return /\b(send|delete|remove|publish|submit|transfer|pay|purchase|checkout|post)\b/i.test(text);
}

function stringifyForApiLog(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pushApiPayload(label, payload) {
  const serialized = stringifyForApiLog(payload);
  const clipped =
    serialized.length > API_LOG_MAX_CHARS
      ? `${serialized.slice(0, API_LOG_MAX_CHARS)}… [truncated ${serialized.length - API_LOG_MAX_CHARS} chars]`
      : serialized;
  pushStatus(`${label}: ${clipped}`, 'api');
}

function parseDecisionJson(rawDecision) {
  const trimmed = String(rawDecision || '').trim();
  if (!trimmed) throw new Error('empty decision payload');

  try {
    return JSON.parse(trimmed);
  } catch {}

  const unfenced = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {}

  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const objectSlice = unfenced.slice(firstBrace, lastBrace + 1);
    return JSON.parse(objectSlice);
  }

  throw new Error('invalid json decision payload');
}

async function conversationalize({ userVoice, cuaReport }) {
  pushStatus(
    `OpenRouter request started for conversational response (model=${process.env.ORCHESTRATOR_MODEL || 'google/gemini-3-flash-preview'}).`,
    'api'
  );
  const requestPayload = {
    model: process.env.ORCHESTRATOR_MODEL || 'google/gemini-3-flash-preview',
    temperature: 0.2,
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: `User asked: "${userVoice}"\nExecution report: ${cuaReport.summary}\nRespond in 1-2 concise spoken sentences.`
      }
    ]
  };
  pushApiPayload('Orchestrator conversational request body', requestPayload);
  const completion = await openrouter.chat.completions.create(requestPayload);

  pushApiPayload('Orchestrator conversational response body', completion?.choices?.[0]?.message?.content || '');
  pushStatus('OpenRouter conversational response received.', 'api');
  return completion.choices[0]?.message?.content?.trim() || cuaReport.summary;
}

async function repairDecisionWithMercury({ rawDecision, userVoice, domain }) {
  const repairModel = process.env.ORCHESTRATOR_REPAIR_MODEL || 'google/gemini-2.5-flash';
  const requestPayload = {
    model: repairModel,
    temperature: 0,
    max_tokens: 220,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Repair malformed orchestrator output. Return only a valid JSON object with keys: action, taskDescription, cuaInstruction, taskScope, clarificationQuestion, confirmationPrompt, response, verboseNarration. Do not include prose, markdown, or lists.'
      },
      {
        role: 'user',
        content: `Domain: ${domain}
User transcript: ${userVoice}
Malformed output:
${rawDecision}`
      }
    ]
  };

  pushApiPayload('Orchestrator repair request body', requestPayload);
  const completion = await openrouter.chat.completions.create(requestPayload);
  const repaired = completion?.choices?.[0]?.message?.content || '';
  pushStatus(`OpenRouter repair response received (model=${repairModel}).`, 'api');
  pushApiPayload('Orchestrator repair response body', repaired);
  return repaired;
}

export async function runOrchestratorTurn(userVoice) {
  if (pendingIrreversibleDecision) {
    if (isAffirmative(userVoice)) {
      const decision = pendingIrreversibleDecision;
      pendingIrreversibleDecision = null;
      const cuaResult = await executeCUAInstruction(decision);
      const reply = await conversationalize({ userVoice: decision.taskDescription, cuaReport: cuaResult });
      addToMemory({ task: decision.taskDescription, result: reply, timestamp: Date.now() });
      return { response: reply };
    }

    if (isNegative(userVoice)) {
      pendingIrreversibleDecision = null;
      return { response: 'Cancelled. I did not perform the irreversible action.' };
    }

    return { response: 'Please say yes to proceed, or no to cancel.' };
  }

  const page = await getPage();
  const url = page.url() || 'https://example.com';
  const domain = new URL(url).hostname;
  pushStatus(`Loading skills for domain=${domain}.`, 'status');
  const skills = await loadSkillsForSite(domain);
  pushStatus(`Loaded ${skills.length} skill(s) for routing.`, 'status');
  const memory = getSessionMemory();

  pushStatus(
    `OpenRouter request started for orchestrator decision (model=${process.env.ORCHESTRATOR_MODEL || 'google/gemini-3-flash-preview'}).`,
    'api'
  );
  const requestPayload = {
    model: process.env.ORCHESTRATOR_MODEL || 'google/gemini-3-flash-preview',
    temperature: 0.1,
    max_tokens: 220,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildOrchestratorPrompt({ skills, memory, domain }) },
      { role: 'user', content: userVoice }
    ]
  };
  pushApiPayload('Orchestrator decision request body', requestPayload);
  const completion = await openrouter.chat.completions.create(requestPayload);
  pushApiPayload('Orchestrator decision response body', completion?.choices?.[0]?.message?.content || '');

  const rawDecision = completion.choices[0]?.message?.content || '{}';
  let decision;
  try {
    decision = parseDecisionJson(rawDecision);
  } catch (error) {
    pushStatus(`Orchestrator JSON parse failed; attempting repair: ${error.message}.`, 'warning');
    try {
      const repairedRaw = await repairDecisionWithMercury({ rawDecision, userVoice, domain });
      decision = parseDecisionJson(repairedRaw);
      pushStatus('Orchestrator decision repaired from malformed JSON.', 'status');
    } catch (repairError) {
      pushStatus(`Orchestrator JSON parse fallback triggered: ${repairError.message}.`, 'warning');
      decision = {
        action: 'clarify',
        clarificationQuestion: 'Which store or website should I use for your weekly groceries?'
      };
    }
  }
  pushStatus(`Orchestrator decision parsed (action=${decision.action || 'unknown'}).`, 'status');

  if (decision.action === 'clarify') {
    return { response: decision.clarificationQuestion || 'Can you clarify what you want me to do?' };
  }

  if (decision.action === 'respond') {
    return { response: decision.response || 'Understood.' };
  }

  const instructionText = `${decision.taskDescription || ''} ${decision.cuaInstruction || ''}`;
  if (decision.action === 'confirm_before_irreversible' || isIrreversible(instructionText)) {
    pendingIrreversibleDecision = {
      ...decision,
      action: 'execute'
    };
    return {
      response:
        decision.confirmationPrompt ||
        `This looks irreversible (${decision.taskDescription || 'requested action'}). Say yes to proceed or no to cancel.`
    };
  }

  if (decision.action === 'execute') {
    pushStatus(`Working: ${decision.taskDescription || decision.cuaInstruction}`, 'status');
    const cuaResult = await executeCUAInstruction(decision);
    const response = await conversationalize({ userVoice, cuaReport: cuaResult });
    addToMemory({ task: userVoice, result: response, timestamp: Date.now() });
    return { response, cuaResult };
  }

  return { response: 'I could not determine the next action.' };
}

export async function interruptCurrentTask() {
  await pauseCUA();
  return { response: 'Paused. What should I change?' };
}
