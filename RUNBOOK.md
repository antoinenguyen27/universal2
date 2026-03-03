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

## Build
1. `npm run build`

## Distribution
1. `npm run dist`
2. Installer artifacts are emitted by `electron-builder` release output.

## Notes
- No `playwright install` step is needed.
- If Chrome path detection fails, the status feed displays searched paths.
