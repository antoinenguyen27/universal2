# Universal Agent

Universal Agent is an open-source Electron desktop app that runs a voice-first browser collaborator. It pairs a React control panel with an agent-owned Chrome window controlled via Stagehand.

## Two-Window Architecture
- Control window (Electron renderer): mode toggle, demo narration toggle, work push-to-talk, transcript/status feed, settings, skill log.
- Agent window (Stagehand Chrome): visible browser controlled by Stagehand `observe()`, `act()`, and `agent({ mode: 'hybrid' })`.

Heavy work runs in Electron main process only: Stagehand, LLM calls, transcription, TTS, and skill file I/O.

## How It Works
- Demo mode:
  - Toggle-on recording with VAD auto-segmentation at natural pauses.
  - Zero-cost page signals (mutating requests, frame navigation, DOM mutation observer bridge).
  - Debounced `observe()` calls (~600ms settle).
  - Gemini 2.5 Flash (via OpenRouter) drafts/refines skill markdown.
  - Confirmation loop writes to `skills/data/<domain>/<slug>.md`.
- Work mode:
  - Push-to-talk command capture.
  - Mercury (via OpenRouter) orchestrates decisions.
  - Domain skills + in-process memory (max 20 entries).
  - Stagehand CUA execution routes through OpenRouter with CUA-capable model.
  - Stop-word interjection runs while CUA is active.

## Getting Started
1. Install dependencies:
   - `npm install`
2. Configure env:
   - `cp .env.example .env`
   - set `OPENROUTER_API_KEY`
3. Ensure Google Chrome is installed.
4. Run dev:
   - `npm run dev`
5. Build renderer:
   - `npm run build`
6. Package installer:
   - `npm run dist`

By default, the agent-owned Chrome launches to `https://www.google.com`. You can override this with `START_URL` in `.env`.

## Security Model
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Minimal preload API via `contextBridge` only
- Renderer never receives direct `ipcRenderer`
- IPC channels are centralized in `electron/ipc-channels.cjs`
- Main process performs all privileged work (filesystem/network/automation)

## Troubleshooting
- Chrome not found:
  - Status feed shows explicit error with searched executable paths.
- Login wall / 2FA during CUA:
  - CUA stops and reports blocker. Complete sign-in in Chrome and retry.
- OpenRouter model errors:
  - Verify `CUA_MODEL`, `ORCHESTRATOR_MODEL`, `DEMO_MODEL`, `STAGEHAND_MODEL` for your account.
- Missing key:
  - Check settings panel OpenRouter indicator and `.env`.

## Dependencies
- `openai` package is used as a generic OpenAI-compatible client for OpenRouter endpoints.
- `@ai-sdk/openai` remains required by Stagehand client wiring in `electron/stagehand-manager.js`.

## Licensing
- License placeholder: MIT or Apache-2.0 (TBD).
