# RUNBOOK

## Prerequisites
- Node.js 20+
- npm 10+
- Google Chrome installed locally
- OpenRouter API key

## Setup
1. `npm install`
2. `cp .env.example .env`
3. Edit `.env` and set `OPENROUTER_API_KEY`

## Development Run
1. `npm run dev`
2. Confirm both windows open:
- Electron control panel window
- Agent-owned Chrome window (spawned by Stagehand)

## LangGraph Runtime Notes
- Work and Demo agent state is checkpointed in-memory per app run.
- Work session reset happens on `WORK_STOP` (or app restart).
- Demo session reset happens on `DEMO_START` and `DEMO_END`.
- Configure max planning loops with `LANGGRAPH_MAX_LOOPS` (default: `8`).
- Enable verbose graph debug behavior with `LANGGRAPH_DEBUG=true`.

## Failure Recovery Behavior
- Tool execution retries transient failures once.
- Auth/security blockers are surfaced immediately without retry.
- Irreversible actions are held until explicit user confirmation.
- `CUA_INTERRUPT` aborts active CUA execution and returns control to planning.

## Build
1. `npm run build`

## Distribution
1. `npm run dist`
2. Installer artifacts are emitted by `electron-builder` release output.

## Notes
- No `playwright install` step is needed.
- If Chrome path detection fails, the status feed displays searched paths.
