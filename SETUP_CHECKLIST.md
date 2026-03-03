# SETUP_CHECKLIST

1. Mic capture in Demo mode
- Switch to Demo mode.
- Click "Start Narrating" once.
- Narrate while using keyboard/mouse in Chrome.
- Confirm transcript segments appear as you pause naturally.

2. VAD auto-segmentation
- Keep Demo recording active.
- Speak two short phrases with >800ms pause between them.
- Verify two separate processed segments are sent.

3. Work push-to-talk
- Switch to Work mode.
- Hold the mic button, speak one command, release.
- Verify one transcript + one orchestrator response.

4. Stop-word interrupt
- Run a long CUA task in Work mode.
- Say "stop" or "pause" while CUA is running.
- Verify interrupt status appears and task pauses.

5. Transcription via Voxtral/OpenRouter
- Ensure only `OPENROUTER_API_KEY` is configured.
- Speak a command and verify transcription quality and latency.

6. Stagehand Chrome spawn
- Start app.
- Confirm visible Chrome window opens automatically.
- If not found, verify clear status error listing searched paths.

7. Demo mode skill writing
- Stay in Demo mode, narrate a short workflow.
- Confirm agent asks for skill confirmation.
- Say "yes" and verify file in `skills/data/<domain>/<slug>.md`.

8. CUA execution via OpenRouter
- In Work mode, issue a reversible browser task.
- Verify status stream and successful completion using selected CUA model.
