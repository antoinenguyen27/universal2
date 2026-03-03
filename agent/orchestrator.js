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

function isAffirmative(text) {
  return /\b(yes|yep|ok|okay|confirm|do it|go ahead|that'?s right|correct)\b/i.test(text);
}

function isNegative(text) {
  return /\b(no|cancel|stop|don'?t|do not|wait)\b/i.test(text);
}

function isIrreversible(text = '') {
  return /\b(send|delete|remove|publish|submit|transfer|pay|purchase|checkout|post)\b/i.test(text);
}

async function conversationalize({ userVoice, cuaReport }) {
  pushStatus(`OpenRouter request started for conversational response (model=${process.env.ORCHESTRATOR_MODEL || 'inception/mercury'}).`, 'api');
  const completion = await openrouter.chat.completions.create({
    model: process.env.ORCHESTRATOR_MODEL || 'inception/mercury',
    temperature: 0.2,
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: `User asked: "${userVoice}"\nExecution report: ${cuaReport.summary}\nRespond in 1-2 concise spoken sentences.`
      }
    ]
  });

  pushStatus('OpenRouter conversational response received.', 'api');
  return completion.choices[0]?.message?.content?.trim() || cuaReport.summary;
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
  const memory = getSessionMemory();

  pushStatus(`OpenRouter request started for orchestrator decision (model=${process.env.ORCHESTRATOR_MODEL || 'inception/mercury'}).`, 'api');
  const completion = await openrouter.chat.completions.create({
    model: process.env.ORCHESTRATOR_MODEL || 'inception/mercury',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildOrchestratorPrompt({ skills, memory, domain }) },
      { role: 'user', content: userVoice }
    ]
  });

  const rawDecision = completion.choices[0]?.message?.content || '{}';
  let decision;
  try {
    decision = JSON.parse(rawDecision);
  } catch {
    decision = { action: 'respond', response: "I couldn't parse that request. Please say it again." };
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
