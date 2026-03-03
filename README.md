# Universal

Universal is an Electron desktop app with a voice-first control panel and an agent-owned Chrome window controlled by Stagehand.

## Architecture
- Renderer (React): mic controls, mode controls, status/transcript feed, settings, skill log.
- Main process (Electron): transcription, LangGraph orchestration, Stagehand browser execution, TTS, skill I/O.
- Agent browser: visible Chrome window launched and controlled by Stagehand.

## Provider Split
- OpenRouter:
  - Voxtral transcription in `/Users/an/Documents/helpinghand/voice/transcription.js`
  - LangGraph orchestrator/demo chat model in `/Users/an/Documents/helpinghand/agent/langgraph/model.js`
- Google Generative AI:
  - Stagehand browser execution in hybrid mode using locked model `google/gemini-3-flash-preview`
- ElevenLabs:
  - Optional TTS provider; system speech fallback remains available.

## Work Runtime
- LangGraph work loop uses tools:
  - `read_skills`
  - `observe_page`
  - `read_session_memory`
  - `navigate`
  - `browser_execute`
- Irreversible actions are held behind explicit confirmation.
- Execution interruptions use `exec:interrupt` and state stream `exec:state`.

## Required Environment
- Required:
  - `OPENROUTER_API_KEY`
  - `GOOGLE_GENERATIVE_AI_API_KEY` -> We need this as stagehand is not compatible with openrouter :( (still want to minimise key requirements)
- Optional:
  - `ELEVENLABS_API_KEY`
  - `ELEVENLABS_VOICE_ID`

Startup is blocked when either required key is missing, and the app emits a startup error status.

## Quick Start
1. `npm install`
2. `cp .env.example .env`
3. Set required keys in `.env`
4. `npm run dev`

## Troubleshooting
- Missing required keys:
  - Check Settings indicators for OpenRouter and Google GenAI.
- Login/MFA/captcha blocker during execution:
  - Complete auth in Chrome, then retry.
- Chrome not found:
  - Stagehand startup error includes searched executable paths.
