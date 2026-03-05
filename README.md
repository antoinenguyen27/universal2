# Universal

Universal is an Electron desktop app with a voice-first control panel and an agent-owned Chrome window controlled by Stagehand.

The original version of Universal was for a submission to Mistral Global Hackathon, we had so much fun building it we had to build out our vision of what it could be in v2.  

You can find it here: [Universal V1](https://github.com/antoinenguyen27/universal)

## Architecture
- Renderer (React): mic controls, mode controls, status/transcript feed, settings, skill log.
- Main process (Electron): transcription, LangGraph orchestration, Stagehand browser execution, TTS, skill I/O.
- Agent browser: visible Chrome window launched and controlled by Stagehand.

## Provider Split
- OpenRouter:
  - Voxtral transcription in `/Users/an/Documents/helpinghand/voice/transcription.js`
  - LangGraph orchestrator/demo chat model in `/Users/an/Documents/helpinghand/agent/langgraph/model.js`
- Anthropic:
  - Stagehand browser execution using locked model `anthropic/claude-haiku-4-5-20251001`
  - Agent mode is configurable in Settings (`DOM`, `CUA`, `Hybrid`; default `CUA`)
  - Stagehand is not compatible with OpenRouter, hence we need the standalone Anthropic key. 
- ElevenLabs:
  - Optional TTS provider; system speech fallback remains available.
  - If `ELEVENLABS_API_KEY` is set and `ELEVENLABS_VOICE_ID` is empty, TTS uses default voice `EST9Ui6982FZPSi7gCHi`.

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
  - `ANTHROPIC_API_KEY`
- Optional:
  - `STAGEHAND_AGENT_MODE` (`dom` | `cua` | `hybrid`, default `cua`)
  - `ELEVENLABS_API_KEY` (enables ElevenLabs TTS)
  - `ELEVENLABS_VOICE_ID` (optional override; defaults to `EST9Ui6982FZPSi7gCHi`)

Startup is not blocked when required keys are missing. The app starts and emits a startup warning, while Work/Demo runtime actions remain unavailable until keys are configured (including via Settings).

## Quick Start
1. `npm install`
2. `cp .env.example .env`
3. Set required keys in `.env`
4. `npm run dev`

## Troubleshooting
- Missing required keys:
  - Check Settings indicators for OpenRouter and Anthropic.
- Login/MFA/captcha blocker during execution:
  - Complete auth in Chrome, then retry.
- Chrome not found:
  - Stagehand startup error includes searched executable paths.
