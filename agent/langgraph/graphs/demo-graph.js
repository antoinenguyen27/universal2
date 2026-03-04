import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { StateGraph, START, END } from '../internal/langgraph-lite.js';
import { DemoGraphState } from '../state.js';
import { createOpenRouterChatModel } from '../model.js';
import { runObservePage } from '../tools/observe-page.js';
import { DEMO_AGENT_SYSTEM_PROMPT } from '../../prompts.js';
import { isAffirmative, normalizeDomain, safeJsonParse } from '../utils.js';
import { writeSkillFromDemo } from '../../../skills/skill-writer.js';
import { pushStatus } from '../../../electron/status-bus.js';

function isCorrection(text = '') {
  return text.trim().length > 0;
}

function normalizeDemoPayload(payload) {
  return {
    message: typeof payload?.message === 'string' ? payload.message : '',
    updatedDraft: typeof payload?.updatedDraft === 'string' ? payload.updatedDraft : null,
    skillComplete: Boolean(payload?.skillComplete),
    finalSkill: typeof payload?.finalSkill === 'string' ? payload.finalSkill : null,
    skillName: typeof payload?.skillName === 'string' && payload.skillName.trim() ? payload.skillName.trim() : 'new-skill'
  };
}

const DEMO_SYNTHESIS_MAX_TOKENS = Number(process.env.DEMO_SYNTHESIS_MAX_TOKENS || 2000);
const DEMO_PARSE_FALLBACK_MESSAGE = "I couldn't parse the draft output. I can retry now.";

function formatMs(value) {
  if (!Number.isFinite(value) || value < 0) return 'unknown';
  return `${Math.round(value)}ms`;
}

function toRelativeMs(epochMs, timelineStartEpochMs) {
  if (!Number.isFinite(epochMs) || !Number.isFinite(timelineStartEpochMs) || timelineStartEpochMs <= 0) {
    return null;
  }
  return Math.max(0, Math.round(epochMs - timelineStartEpochMs));
}

function renderVoiceContext(segments = []) {
  if (!segments.length) return '- (none)';
  return segments
    .map((segment) => {
      const tStart = formatMs(segment.tStartMs);
      const tEnd = formatMs(segment.tEndMs);
      const receivedAt = formatMs(segment.receivedAtMs);
      return `- [${tStart} -> ${tEnd}] (received=${receivedAt}) ${segment.transcript}`;
    })
    .join('\n');
}

function renderObservedContext(observationTimeline = []) {
  if (!observationTimeline.length) return '(No observed interactive elements.)';
  return observationTimeline
    .slice(-6)
    .map((snapshot, index) => {
      const header = `${index + 1}. t=${formatMs(snapshot.observedAtMs)} source=${snapshot.source || 'unknown'} weakContext=${snapshot.weakContext ? 'yes' : 'no'}`;
      const lines = (snapshot.observedElements || [])
        .slice(0, 12)
        .map((element, itemIndex) => `   ${itemIndex + 1}) "${element.description}" [${element.method || 'act'}]`)
        .join('\n');
      return `${header}\n${lines || '   (none)'}`;
    })
    .join('\n');
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      return '';
    })
    .join('\n')
    .trim();
}

function extractJsonCandidate(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenceMatch?.[1] ? fenceMatch[1].trim() : raw;
  const start = source.indexOf('{');
  if (start < 0) return source;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return source.slice(start);
}

function isValidDemoPayloadShape(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;

  const fieldsValid =
    (payload.message === undefined || typeof payload.message === 'string') &&
    (payload.updatedDraft === undefined || payload.updatedDraft === null || typeof payload.updatedDraft === 'string') &&
    (payload.skillComplete === undefined || typeof payload.skillComplete === 'boolean') &&
    (payload.finalSkill === undefined || payload.finalSkill === null || typeof payload.finalSkill === 'string') &&
    (payload.skillName === undefined || payload.skillName === null || typeof payload.skillName === 'string');

  if (!fieldsValid) return false;

  const hasUsefulContent =
    (typeof payload.message === 'string' && payload.message.trim().length > 0) ||
    (typeof payload.updatedDraft === 'string' && payload.updatedDraft.trim().length > 0) ||
    (typeof payload.finalSkill === 'string' && payload.finalSkill.trim().length > 0);

  return hasUsefulContent || payload.skillComplete === true;
}

function maybeTruncated(completion, rawText = '') {
  const finishReason =
    completion?.response_metadata?.finish_reason ||
    completion?.response_metadata?.stop_reason ||
    completion?.additional_kwargs?.finish_reason ||
    '';
  if (String(finishReason).toLowerCase().includes('length')) return true;

  const trimmed = String(rawText || '').trim();
  if (!trimmed) return false;
  if (trimmed.includes('{') && !trimmed.includes('}')) return true;
  return false;
}

async function invokeSynthesisModel(model, prompt) {
  return model.invoke([
    new SystemMessage(DEMO_AGENT_SYSTEM_PROMPT),
    new HumanMessage(prompt)
  ]);
}

async function synthesizeDraft({ pageUrl, voiceSegments, observationTimeline, currentDraft, correction }) {
  const model = createOpenRouterChatModel({
    model: process.env.DEMO_MODEL || 'google/gemini-2.5-flash',
    temperature: 0.1,
    maxTokens: DEMO_SYNTHESIS_MAX_TOKENS
  });

  const basePrompt = `Site: ${normalizeDomain(pageUrl)}
Page URL: ${pageUrl}
Voice:
${renderVoiceContext(voiceSegments)}

Observed elements:
${renderObservedContext(observationTimeline)}

Current draft:
${currentDraft || '(none)'}

Correction from user: ${correction || '(none)'}

Return strict JSON only.`;

  const completion = await invokeSynthesisModel(model, basePrompt);
  const rawText = extractTextContent(completion?.content);
  const candidate = extractJsonCandidate(rawText);
  const parsed = safeJsonParse(candidate, null);
  if (maybeTruncated(completion, rawText)) {
    pushStatus('Demo synthesis output may be truncated (finish_reason=length or incomplete JSON).', 'warning');
  }

  if (isValidDemoPayloadShape(parsed)) {
    pushStatus('Demo synthesis parse succeeded.', 'api');
    return normalizeDemoPayload(parsed);
  }

  pushStatus('Demo synthesis parse failed; attempting one JSON repair retry.', 'warning');
  const snippet = String(rawText || '').slice(0, 1800);
  const repairPrompt = `The previous output could not be parsed as valid JSON for this schema:
{
  "message": "string",
  "updatedDraft": "string or null",
  "skillComplete": true/false,
  "finalSkill": "string or null",
  "skillName": "string or null"
}

Return only one valid JSON object and nothing else.
Previous output:
${snippet || '(empty)'}`;

  const repairedCompletion = await invokeSynthesisModel(model, repairPrompt);
  const repairedRawText = extractTextContent(repairedCompletion?.content);
  const repairedCandidate = extractJsonCandidate(repairedRawText);
  const repairedParsed = safeJsonParse(repairedCandidate, null);
  if (maybeTruncated(repairedCompletion, repairedRawText)) {
    pushStatus('Demo synthesis repair output may be truncated.', 'warning');
  }

  if (isValidDemoPayloadShape(repairedParsed)) {
    pushStatus('Demo synthesis repair retry succeeded.', 'api');
    return normalizeDemoPayload(repairedParsed);
  }

  pushStatus('Demo synthesis repair retry failed; using fallback response.', 'warning');
  return {
    message: DEMO_PARSE_FALLBACK_MESSAGE,
    updatedDraft: currentDraft || null,
    skillComplete: false,
    finalSkill: null,
    skillName: 'new-skill'
  };
}

async function ingestDemoEvent(state) {
  const eventType = state.eventType || 'voice';
  const transcript = String(state.transcript || '').trim();
  const transcriptTiming = state.transcriptTiming || null;
  const timelineStartEpochMs = Number(state.demoTimelineStartEpochMs) || 0;

  const next = {
    saveRequested: eventType === 'save',
    reviewRequested: eventType === 'finalize',
    agentMessage: '',
    skillWritten: null
  };

  if (eventType === 'voice' && transcript) {
    const receivedAtMs = toRelativeMs(Date.now(), timelineStartEpochMs);
    next.messages = [new HumanMessage(transcript)];
    next.pendingVoice = [
      {
        transcript,
        tStartMs: Number.isFinite(transcriptTiming?.tStartMs) ? transcriptTiming.tStartMs : null,
        tEndMs: Number.isFinite(transcriptTiming?.tEndMs) ? transcriptTiming.tEndMs : null,
        receivedAtMs: Number.isFinite(receivedAtMs) ? receivedAtMs : 0
      }
    ];
  }

  return next;
}

async function contextCollect(state) {
  if (state.eventType === 'save') return {};

  try {
    const observe = await runObservePage({
      reason: state.eventType === 'finalize' ? 'review-start' : 'demo-voice',
      limit: 25,
      timelineStartEpochMs: Number(state.demoTimelineStartEpochMs) || 0
    });
    return {
      observedElements: observe.observedElements,
      observationTimeline: [
        {
          observedAtMs: Number.isFinite(observe.observedAtMs) ? observe.observedAtMs : null,
          source: observe.source || 'stagehand',
          weakContext: Boolean(observe.weakContext),
          observedElements: observe.observedElements || []
        }
      ],
      pageUrl: observe.url
    };
  } catch (error) {
    pushStatus(`Demo observe failed: ${String(error?.message || error)}`, 'warning');
    return {
      observedElements: state.observedElements || [],
      pageUrl: state.pageUrl || 'https://example.com'
    };
  }
}

async function demoSynthesisAgent(state) {
  if (state.eventType === 'save') return {};

  const transcript = String(state.transcript || '').trim();
  if (!transcript && state.eventType === 'voice') {
    return { agentMessage: 'I did not catch that. Please repeat what you demonstrated.' };
  }

  if (state.awaitingConfirmation && state.eventType === 'voice') {
    if (isAffirmative(transcript)) {
      return { saveRequested: true };
    }

    if (isCorrection(transcript)) {
      const receivedAtMs = toRelativeMs(Date.now(), Number(state.demoTimelineStartEpochMs) || 0);
      const revised = await synthesizeDraft({
        pageUrl: state.pageUrl || 'https://example.com',
        voiceSegments: [
          {
            transcript,
            tStartMs: Number.isFinite(state.transcriptTiming?.tStartMs) ? state.transcriptTiming.tStartMs : null,
            tEndMs: Number.isFinite(state.transcriptTiming?.tEndMs) ? state.transcriptTiming.tEndMs : null,
            receivedAtMs: Number.isFinite(receivedAtMs) ? receivedAtMs : 0
          }
        ],
        observationTimeline: state.observationTimeline || [],
        currentDraft: state.awaitingConfirmation.finalSkill,
        correction: transcript
      });

      if (revised.skillComplete && revised.finalSkill) {
        return {
          currentSkillDraft: revised.updatedDraft || revised.finalSkill,
          awaitingConfirmation: {
            finalSkill: revised.finalSkill,
            skillName: revised.skillName,
            domain: normalizeDomain(state.pageUrl || 'https://example.com')
          },
          agentMessage: revised.message || 'Updated draft based on your correction. Confirm when ready.'
        };
      }

      return {
        currentSkillDraft: revised.updatedDraft || state.currentSkillDraft,
        agentMessage: revised.message || DEMO_PARSE_FALLBACK_MESSAGE
      };
    }
  }

  if (state.awaitingConfirmation && state.eventType === 'finalize') {
    return {
      agentMessage: `I have a complete draft for '${state.awaitingConfirmation.skillName}'. Click Create Skill to save, or reply with corrections.`
    };
  }

  const reviewSegments = state.reviewRequested
    ? state.pendingVoice.length
      ? state.pendingVoice
      : [{ transcript: 'User ended demo capture and wants to finalize the skill.', tStartMs: null, tEndMs: null, receivedAtMs: 0 }]
    : state.pendingVoice;

  const synthesis = await synthesizeDraft({
    pageUrl: state.pageUrl || 'https://example.com',
    voiceSegments: reviewSegments,
    observationTimeline: state.observationTimeline || [],
    currentDraft: state.currentSkillDraft,
    correction: state.reviewRequested
      ? 'User ended demo capture and entered review. Ask one concise clarifying question if needed, otherwise finalize.'
      : null
  });

  if (synthesis.updatedDraft) {
    if (synthesis.skillComplete && synthesis.finalSkill) {
      return {
        currentSkillDraft: synthesis.updatedDraft,
        awaitingConfirmation: {
          finalSkill: synthesis.finalSkill,
          skillName: synthesis.skillName,
          domain: normalizeDomain(state.pageUrl || 'https://example.com')
        },
        agentMessage:
          synthesis.message ||
          `I have a complete draft for '${synthesis.skillName}'. Click Create Skill to save, or reply with corrections.`
      };
    }

    return {
      currentSkillDraft: synthesis.updatedDraft,
      agentMessage: synthesis.message || 'Captured. Continue demonstrating or refine the draft.'
    };
  }

  return {
    agentMessage: synthesis.message || DEMO_PARSE_FALLBACK_MESSAGE
  };
}

async function demoConfirmationGate(state) {
  if (state.saveRequested && !state.awaitingConfirmation) {
    return {
      agentMessage: 'I still need to finalize the draft before saving. Continue review first.'
    };
  }
  return {};
}

async function saveSkillNode(state) {
  if (!state.saveRequested || !state.awaitingConfirmation) return {};

  const pending = state.awaitingConfirmation;
  const saved = await writeSkillFromDemo({
    domain: pending.domain,
    skillName: pending.skillName,
    finalSkill: pending.finalSkill
  });

  pushStatus(`Skill saved: ${saved.domain}/${saved.filename}`, 'status');

  return {
    awaitingConfirmation: null,
    currentSkillDraft: null,
    pendingVoice: [],
    observationTimeline: [],
    saveRequested: false,
    skillWritten: saved,
    agentMessage: `Saved '${pending.skillName}' for ${pending.domain}.`
  };
}

async function demoResponse() {
  return {};
}

function routeAfterConfirmation(state) {
  if (state.saveRequested && state.awaitingConfirmation) return 'save_skill';
  return 'demo_response';
}

export function createDemoGraph(checkpointer) {
  const graph = new StateGraph(DemoGraphState)
    .addNode('ingest_demo_event', ingestDemoEvent)
    .addNode('context_collect', contextCollect)
    .addNode('demo_synthesis_agent', demoSynthesisAgent)
    .addNode('demo_confirmation_gate', demoConfirmationGate)
    .addNode('save_skill', saveSkillNode)
    .addNode('demo_response', demoResponse)
    .addEdge(START, 'ingest_demo_event')
    .addEdge('ingest_demo_event', 'context_collect')
    .addEdge('context_collect', 'demo_synthesis_agent')
    .addEdge('demo_synthesis_agent', 'demo_confirmation_gate')
    .addConditionalEdges('demo_confirmation_gate', routeAfterConfirmation, ['save_skill', 'demo_response'])
    .addEdge('save_skill', 'demo_response')
    .addEdge('demo_response', END);

  return graph.compile({ checkpointer });
}
