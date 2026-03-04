import { MemorySaver } from './internal/langgraph-lite.js';
import { createWorkGraph, buildWorkGraphInput } from './graphs/work-graph.js';
import { createDemoGraph } from './graphs/demo-graph.js';

const checkpointer = new MemorySaver();

let compiledWorkGraph = null;
let compiledDemoGraph = null;

let workThreadId = `work-${Date.now()}`;
let demoThreadId = `demo-${Date.now()}`;

function graphConfig(threadId) {
  return {
    configurable: {
      thread_id: threadId
    }
  };
}

function getWorkGraph() {
  if (!compiledWorkGraph) {
    compiledWorkGraph = createWorkGraph(checkpointer);
  }
  return compiledWorkGraph;
}

function getDemoGraph() {
  if (!compiledDemoGraph) {
    compiledDemoGraph = createDemoGraph(checkpointer);
  }
  return compiledDemoGraph;
}

export async function runWorkGraphTurn({ userVoice, pageUrl }) {
  const graph = getWorkGraph();
  const input = await buildWorkGraphInput({ userVoice, pageUrl });
  const state = await graph.invoke(input, graphConfig(workThreadId));
  return {
    response: state.finalResponse || 'Understood.',
    state
  };
}

export async function runDemoGraphTurn({ eventType, transcript, pageUrl, demoTimelineStartEpochMs, transcriptTiming }) {
  const graph = getDemoGraph();
  const state = await graph.invoke(
    {
      eventType,
      transcript: transcript || '',
      pageUrl: pageUrl || 'https://example.com',
      demoTimelineStartEpochMs: Number.isFinite(demoTimelineStartEpochMs) ? demoTimelineStartEpochMs : 0,
      transcriptTiming: transcriptTiming || null
    },
    graphConfig(demoThreadId)
  );

  return {
    agentMessage: state.agentMessage || 'Captured.',
    skillWritten: state.skillWritten || null,
    awaitingConfirmation: Boolean(state.awaitingConfirmation),
    state
  };
}

export function resetWorkGraphState() {
  workThreadId = `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function resetDemoGraphState() {
  demoThreadId = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
