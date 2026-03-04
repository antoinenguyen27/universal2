import { getPage } from '../electron/stagehand-manager.js';
import { pushStatus } from '../electron/status-bus.js';
import { runDemoGraphTurn, resetDemoGraphState } from './langgraph/runtime.js';

const state = {
  active: false,
  pageUrl: 'https://example.com',
  lastGraphState: null,
  timelineStartEpochMs: 0
};

function toRelativeMs(epochMs, timelineStartEpochMs) {
  if (!Number.isFinite(epochMs) || !Number.isFinite(timelineStartEpochMs) || timelineStartEpochMs <= 0) {
    return null;
  }
  return Math.max(0, Math.round(epochMs - timelineStartEpochMs));
}

function normalizeTranscriptTiming(segmentTiming, timelineStartEpochMs) {
  const startedAtEpochMs = Number(segmentTiming?.segmentStartedAtMs);
  const endedAtEpochMs = Number(segmentTiming?.segmentEndedAtMs);
  const providedDurationMs = Number(segmentTiming?.segmentDurationMs);

  const tStartMs = toRelativeMs(startedAtEpochMs, timelineStartEpochMs);
  const tEndMs = toRelativeMs(endedAtEpochMs, timelineStartEpochMs);

  let durationMs = Number.isFinite(providedDurationMs) && providedDurationMs > 0 ? Math.round(providedDurationMs) : null;
  if (!durationMs && Number.isFinite(tStartMs) && Number.isFinite(tEndMs)) {
    durationMs = Math.max(0, tEndMs - tStartMs);
  }

  return {
    tStartMs,
    tEndMs,
    durationMs
  };
}

async function getCurrentPageUrl() {
  const page = await getPage().catch(() => null);
  const pageUrl = typeof page?.url === 'function' ? page.url() : 'https://example.com';
  return pageUrl || 'https://example.com';
}

export async function startDemoSession() {
  const pageUrl = await getCurrentPageUrl();
  const isBlankPage = !pageUrl || pageUrl === 'about:blank';

  if (isBlankPage) {
    throw new Error('Demo mode cannot start on about:blank. Open a website in the agent browser first.');
  }

  state.active = true;
  state.pageUrl = pageUrl;
  state.lastGraphState = null;
  state.timelineStartEpochMs = Date.now();
  resetDemoGraphState();

  pushStatus('Demo mode active. Narrate your actions while demonstrating in Chrome.', 'status');
}

export async function endDemoSession() {
  const summary = {
    hadDraft: Boolean(state.lastGraphState?.currentSkillDraft),
    lastObserveReason: null,
    pendingVoiceCount: Array.isArray(state.lastGraphState?.pendingVoice) ? state.lastGraphState.pendingVoice.length : 0
  };

  const hadActiveSession = state.active;
  state.active = false;
  state.lastGraphState = null;
  state.timelineStartEpochMs = 0;

  if (hadActiveSession) {
    pushStatus('Demo mode ended.', 'status');
  }

  return summary;
}

export async function handleVoiceSegment(transcript, segmentTiming) {
  if (!state.active) {
    return { agentMessage: 'Demo mode is not active.', skillWritten: null, awaitingConfirmation: false };
  }

  state.pageUrl = await getCurrentPageUrl();
  const transcriptTiming = normalizeTranscriptTiming(segmentTiming || {}, state.timelineStartEpochMs);
  const result = await runDemoGraphTurn({
    eventType: 'voice',
    transcript,
    pageUrl: state.pageUrl,
    demoTimelineStartEpochMs: state.timelineStartEpochMs,
    transcriptTiming
  });

  state.lastGraphState = result.state;

  return {
    agentMessage: result.agentMessage,
    skillWritten: result.skillWritten,
    awaitingConfirmation: result.awaitingConfirmation
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

  state.pageUrl = await getCurrentPageUrl();
  const result = await runDemoGraphTurn({
    eventType: 'finalize',
    transcript: '',
    pageUrl: state.pageUrl,
    demoTimelineStartEpochMs: state.timelineStartEpochMs
  });

  state.lastGraphState = result.state;

  return {
    agentMessage: result.agentMessage,
    skillWritten: result.skillWritten,
    awaitingConfirmation: result.awaitingConfirmation
  };
}

export async function saveDraftFromReview() {
  if (!state.active) {
    return {
      agentMessage: 'Demo mode is not active.',
      skillWritten: null,
      awaitingConfirmation: false
    };
  }

  const result = await runDemoGraphTurn({
    eventType: 'save',
    transcript: '',
    pageUrl: state.pageUrl,
    demoTimelineStartEpochMs: state.timelineStartEpochMs
  });

  state.lastGraphState = result.state;

  return {
    agentMessage: result.agentMessage,
    skillWritten: result.skillWritten,
    awaitingConfirmation: result.awaitingConfirmation
  };
}
