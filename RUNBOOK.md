# RUNBOOK

## Prerequisites
- Node.js 20+
- npm 10+
- Google Chrome installed locally
- `OPENROUTER_API_KEY` -> Transcription + orchestrator
- `ANTHROPIC_API_KEY` -> Computer-use agent (Stagehand browser execution) Stagehand is not compatible with open router so we need a standalone key.
- `STAGEHAND_AGENT_MODE` (optional) -> `dom`, `cua`, or `hybrid` (default `cua`)

## Setup
1. `npm install`
2. `cp .env.example .env`
3. Set required keys in `.env`

## Development Run
1. `npm run dev`
2. Confirm both windows open:
- Electron control panel
- Agent-owned Chrome (Stagehand LOCAL)

## Runtime Notes
- Work and Demo graph state is in-memory per app run.
- Work reset occurs on `WORK_STOP`.
- Demo reset occurs on `DEMO_START` and `DEMO_END`.
- Execution interruption channel: `EXEC_INTERRUPT` (`exec:interrupt`).
- Execution state channel: `EXEC_STATE` (`exec:state`).

## Failure Recovery
- `browser_execute` retries one transient failure.
- Auth/security blockers are surfaced immediately.
- Irreversible actions require explicit user confirmation.
- Interrupting execution returns control to planning.

## Build
1. `npm run build`

## Distribution
1. `npm run dist`
