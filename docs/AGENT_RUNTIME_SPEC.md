# Agent Runtime Spec (LangGraph)

## Scope
This spec defines the LangGraph runtime that replaces prompt-only orchestration for both Work mode and Demo mode.

Persistence target: in-memory checkpoints across turns during one app run.

## Runtime Layout
- `agent/langgraph/runtime.js`: graph compilation, checkpointer, thread IDs, run/reset APIs.
- `agent/langgraph/state.js`: graph state annotations.
- `agent/langgraph/tools/*`: shared tool adapters.
- `agent/langgraph/graphs/work-graph.js`: work orchestration graph.
- `agent/langgraph/graphs/demo-graph.js`: demo orchestration graph.

## Work Graph

### Nodes
1. `ingest_user_turn`
- Input: user transcript + page URL/domain.
- Effect: append human message and reset per-turn loop counters.

2. `agent_plan`
- Uses OpenRouter-backed tool-calling model.
- Decides direct response vs tool usage.
- Handles yes/no confirmation turns against pending irreversible operations.

3. `tool_exec`
- ToolNode executor for all registered work tools.

4. `safety_gate`
- Intercepts irreversible `cua_execute` requests.
- Stores pending execution and emits confirmation prompt.

5. `respond`
- Produces final spoken response and writes compatibility memory entry.

### Edges
- `START -> ingest_user_turn -> agent_plan`
- `agent_plan -> tool_exec` (when tool calls present)
- `tool_exec -> agent_plan` (loop)
- `agent_plan -> safety_gate -> respond` (irreversible operations)
- `agent_plan -> respond` (direct response)
- `respond -> END`

### Limits
- `LANGGRAPH_MAX_LOOPS` default `8`.
- Tool failure retry count default `1` retry (2 total attempts).

## Demo Graph

### Nodes
1. `ingest_demo_event`
- Normalizes event (`voice`, `finalize`, `save`) and updates turn flags.

2. `context_collect`
- Calls `observe_page` tool adapter to refresh observed UI context.

3. `demo_synthesis_agent`
- Generates/updates skill draft from narration + observed context.
- Handles correction loop when awaiting confirmation.

4. `demo_confirmation_gate`
- Routes save vs continue.

5. `save_skill`
- Persists skill markdown via existing skill writer adapter.

6. `demo_response`
- Returns final response payload.

### Edges
- `START -> ingest_demo_event -> context_collect -> demo_synthesis_agent -> demo_confirmation_gate`
- `demo_confirmation_gate -> save_skill -> demo_response`
- `demo_confirmation_gate -> demo_response`
- `demo_response -> END`

## Tool Contracts

### `read_skills`
- Input: `{ domain: string }`
- Output: `{ skills: [{ name, domain, content }] }`

### `observe_page`
- Input: `{ reason: string, limit?: number }`
- Output: `{ url, observedElements, source, weakContext }`

### `read_session_memory`
- Input: `{ limit?: number }`
- Output: `{ entries }`

### `navigate`
- Input: `{ url: string }`
- Output: `{ url, navigated: boolean }`

### `cua_execute`
- Input: `{ taskDescription, cuaInstruction, taskScope }`
- Output: `{ success, summary, blockedByAuth?, interrupted?, raw?, attempts, retriesExhausted }`

## Failure and Recovery Rules
- Retry transient tool failures once.
- Do not retry auth/security blockers.
- Require explicit confirmation before irreversible execution.
- Respect CUA interrupt and return control to planner.
- If retries exhaust, return blocker response with concrete next step.

## Compatibility Requirements
- Keep existing IPC contracts unchanged.
- Keep existing renderer payload shapes unchanged.
- Maintain compatibility memory writes during migration (`memory/session-memory.js`).

## Acceptance Criteria
1. Multi-step work tasks execute through tool loop.
2. Irreversible actions require explicit yes/no confirmation.
3. Tool failure retries and blocker reporting work deterministically.
4. Demo flow supports draft iteration, finalize, correction, and save.
5. Context persists across turns within one app run (thread checkpoint continuity).
