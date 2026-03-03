import { buildCUASystemPrompt } from './prompts.js';
import { getStagehand } from '../electron/stagehand-manager.js';
import { pushStatus, pushCUAState } from '../electron/status-bus.js';

let activeAbortController = null;
let cuaRunning = false;
let lastProgressAt = 0;
let progressTimer = null;

function startNoProgressWatchdog() {
  clearNoProgressWatchdog();
  progressTimer = setInterval(() => {
    if (!cuaRunning) return;
    const elapsed = Date.now() - lastProgressAt;
    if (elapsed > 5 * 60 * 1000) {
      pushStatus('Warning: no browser progress for over 5 minutes. You can say stop and retry.', 'warning');
      lastProgressAt = Date.now();
    }
  }, 10_000);
}

function clearNoProgressWatchdog() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

function resolveCUAProvider(decision) {
  const model = process.env.CUA_MODEL || 'anthropic/claude-sonnet-4-20250514';
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error('Missing OPENROUTER_API_KEY for CUA model execution.');
  }

  return { model, apiKey, taskScope: decision.taskScope || 'short' };
}

export async function executeCUAInstruction(decision) {
  const sh = await getStagehand();
  const provider = resolveCUAProvider(decision);
  const systemPrompt = buildCUASystemPrompt(decision);

  activeAbortController = new AbortController();
  cuaRunning = true;
  pushCUAState(true);
  lastProgressAt = Date.now();
  startNoProgressWatchdog();

  pushStatus(`Executing: ${decision.taskDescription}`, 'status');
  pushStatus(`CUA provider ready (model=${provider.model}, endpoint=https://openrouter.ai/api/v1).`, 'api');

  try {
    // Verified via web: Stagehand agent() accepts model object with modelName/apiKey/baseURL for OpenAI-compatible endpoints.
    const agent = sh.agent({
      mode: 'hybrid',
      model: {
        modelName: provider.model,
        apiKey: provider.apiKey,
        baseURL: 'https://openrouter.ai/api/v1'
      },
      maxSteps: provider.taskScope === 'long' ? 35 : 15,
      systemPrompt,
      callbacks: {
        onStepFinish: (step) => {
          const summary = step?.text || step?.description || 'Completed browser step';
          lastProgressAt = Date.now();
          pushStatus(summary, 'status');
        }
      }
    });

    const result = await agent.execute({
      instruction: decision.cuaInstruction,
      signal: activeAbortController.signal,
      maxSteps: provider.taskScope === 'long' ? 35 : 15
    });

    return {
      success: true,
      summary: result?.summary || result?.message || 'Task completed.',
      raw: result
    };
  } catch (error) {
    if (activeAbortController?.signal.aborted) {
      pushStatus('CUA execution interrupted by user.', 'warning');
      return { success: false, interrupted: true, summary: 'Execution interrupted by user.' };
    }

    const details = String(error?.message || error || 'unknown error');
    pushStatus(`CUA execution error: ${details}`, 'error');
    if (/login|sign in|2fa|verification|captcha/i.test(details)) {
      return {
        success: false,
        blockedByAuth: true,
        summary: 'Hit a login or verification wall. Please sign in within the browser window, then retry.'
      };
    }

    return {
      success: false,
      summary: `Execution failed: ${details}`
    };
  } finally {
    cuaRunning = false;
    activeAbortController = null;
    clearNoProgressWatchdog();
    pushCUAState(false);
  }
}

export async function pauseCUA() {
  if (!cuaRunning || !activeAbortController) return { ok: true, interrupted: false };

  activeAbortController.abort();
  pushStatus('Paused current task. Listening for your next instruction.', 'status');
  return { ok: true, interrupted: true };
}

export function isCUARunning() {
  return cuaRunning;
}
