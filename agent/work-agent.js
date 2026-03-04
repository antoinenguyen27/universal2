import { buildExecutionSystemPrompt } from './prompts.js';
import { getStagehand } from '../electron/stagehand-manager.js';
import { pushStatus, pushExecutionState } from '../electron/status-bus.js';

let activeAbortController = null;
let executionRunning = false;
let activeAgent = null;
let lastProgressAt = 0;
let progressTimer = null;
const EXECUTION_TRACE_MAX_CHARS = Number(process.env.EXECUTION_TRACE_MAX_CHARS || 2500);
const EXECUTION_MODEL = 'anthropic/claude-haiku-4-5-20251001';

function stringifyForTrace(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pushExecutionTrace(label, payload) {
  const serialized = stringifyForTrace(payload);
  const clipped =
    serialized.length > EXECUTION_TRACE_MAX_CHARS
      ? `${serialized.slice(0, EXECUTION_TRACE_MAX_CHARS)}... [truncated ${serialized.length - EXECUTION_TRACE_MAX_CHARS} chars]`
      : serialized;
  pushStatus(`Execution trace - ${label}: ${clipped}`, 'api');
}

function startNoProgressWatchdog() {
  clearNoProgressWatchdog();
  progressTimer = setInterval(() => {
    if (!executionRunning) return;
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

function resolveExecutionConfig(decision) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY for hybrid execution.');
  }

  return {
    model: EXECUTION_MODEL,
    taskScope: decision.taskScope || 'short'
  };
}

export async function executeBrowserInstruction(decision) {
  const sh = await getStagehand();
  const execution = resolveExecutionConfig(decision);
  const systemPrompt = buildExecutionSystemPrompt(decision);

  activeAbortController = new AbortController();
  executionRunning = true;
  pushExecutionState(true);
  lastProgressAt = Date.now();
  startNoProgressWatchdog();

  pushStatus(`Executing: ${decision.taskDescription}`, 'status');
  pushStatus(`Hybrid execution ready (model=${execution.model}).`, 'api');

  try {
    activeAgent = sh.agent({
      mode: 'hybrid',
      model: execution.model,
      maxSteps: execution.taskScope === 'long' ? 35 : 15,
      systemPrompt,
      callbacks: {
        onStepFinish: (step) => {
          const summary = step?.text || step?.description || 'Completed browser step';
          lastProgressAt = Date.now();
          pushStatus(summary, 'status');
        }
      }
    });
    pushExecutionTrace('execute.request', {
      model: execution.model,
      taskScope: execution.taskScope,
      instruction: decision.instruction
    });

    const result = await activeAgent.execute({
      instruction: decision.instruction,
      maxSteps: execution.taskScope === 'long' ? 35 : 15
    });
    pushExecutionTrace('execute.result', result || {});

    const reportedSuccess = result?.success !== false && result?.completed !== false;
    return {
      success: reportedSuccess,
      summary: result?.summary || result?.message || (reportedSuccess ? 'Task completed.' : 'Task failed.'),
      raw: result
    };
  } catch (error) {
    if (activeAbortController?.signal.aborted) {
      pushStatus('Execution interrupted by user.', 'warning');
      return { success: false, interrupted: true, summary: 'Execution interrupted by user.' };
    }

    const details = String(error?.message || error || 'unknown error');
    pushExecutionTrace('execute.error', {
      name: error?.name || 'Error',
      message: details,
      code: error?.code || null,
      status: error?.status || error?.statusCode || null,
      cause: error?.cause ? String(error.cause?.message || error.cause) : null,
      responseBody: error?.response?.data || error?.response?.body || error?.body || null
    });
    pushStatus(`Execution error: ${details}`, 'error');
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
    executionRunning = false;
    activeAbortController = null;
    activeAgent = null;
    clearNoProgressWatchdog();
    pushExecutionState(false);
  }
}

export async function pauseExecution() {
  if (!executionRunning || !activeAbortController) return { ok: true, interrupted: false };

  activeAbortController.abort();
  try {
    await activeAgent?.stop?.();
  } catch {
    // Best effort stop; abort signal is still set for interruption flow.
  }
  pushStatus('Paused current task. Listening for your next instruction.', 'status');
  return { ok: true, interrupted: true };
}

export function isExecutionRunning() {
  return executionRunning;
}
