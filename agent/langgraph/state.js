import { Annotation } from './internal/langgraph-lite.js';

const passthrough = (left, right) => (right === undefined ? left : right);
const appendMessages = (left = [], right = []) => {
  if (!right) return left;
  return left.concat(Array.isArray(right) ? right : [right]);
};
const appendVoice = (left = [], right = []) => {
  if (!right) return left;
  return left.concat(Array.isArray(right) ? right : [right]);
};
const appendObservationSnapshots = (left = [], right = []) => {
  if (!right) return left;
  return left.concat(Array.isArray(right) ? right : [right]).slice(-40);
};

export const WorkGraphState = Annotation.Root({
  messages: Annotation({
    reducer: appendMessages,
    default: () => []
  }),
  userVoice: Annotation({ reducer: passthrough, default: () => '' }),
  domain: Annotation({ reducer: passthrough, default: () => '' }),
  pageUrl: Annotation({ reducer: passthrough, default: () => '' }),
  awaitingConfirmation: Annotation({ reducer: passthrough, default: () => false }),
  pendingExecution: Annotation({ reducer: passthrough, default: () => null }),
  finalResponse: Annotation({ reducer: passthrough, default: () => '' }),
  loopCount: Annotation({ reducer: passthrough, default: () => 0 }),
  toolErrorCount: Annotation({ reducer: passthrough, default: () => 0 })
});

export const DemoGraphState = Annotation.Root({
  messages: Annotation({
    reducer: appendMessages,
    default: () => []
  }),
  eventType: Annotation({ reducer: passthrough, default: () => 'voice' }),
  transcript: Annotation({ reducer: passthrough, default: () => '' }),
  transcriptTiming: Annotation({ reducer: passthrough, default: () => null }),
  pageUrl: Annotation({ reducer: passthrough, default: () => '' }),
  demoTimelineStartEpochMs: Annotation({ reducer: passthrough, default: () => 0 }),
  pendingVoice: Annotation({
    reducer: appendVoice,
    default: () => []
  }),
  observedElements: Annotation({ reducer: passthrough, default: () => [] }),
  observationTimeline: Annotation({
    reducer: appendObservationSnapshots,
    default: () => []
  }),
  currentSkillDraft: Annotation({ reducer: passthrough, default: () => null }),
  awaitingConfirmation: Annotation({ reducer: passthrough, default: () => null }),
  saveRequested: Annotation({ reducer: passthrough, default: () => false }),
  reviewRequested: Annotation({ reducer: passthrough, default: () => false }),
  agentMessage: Annotation({ reducer: passthrough, default: () => '' }),
  skillWritten: Annotation({ reducer: passthrough, default: () => null })
});
