# SETUP_CHECKLIST

1. Startup key validation
- Unset `OPENROUTER_API_KEY` and start app.
- Verify startup warning is shown and Work/Demo actions are unavailable until key is configured in Settings.
- Repeat for missing `ANTHROPIC_API_KEY`.

2. Work push-to-talk
- Switch to Work mode.
- Hold mic, speak one command, release.
- Verify transcript and orchestrated response.

3. Browser execution mode
- Trigger a reversible browser task in Work mode.
- Verify `browser_execute` runs and reports step/status updates.
- Confirm model is `anthropic/claude-haiku-4-5-20251001` in status/API trace logs.
- Confirm mode switches work via Settings (`DOM`, `CUA`, `Hybrid`) and status/API trace logs show selected mode.

4. Interrupt behavior
- Start a long browser task.
- Say "stop" or "pause".
- Verify interrupt status and execution stops via execution interrupt path.

5. Irreversible gate
- Request send/delete/publish/payment/checkout action.
- Verify explicit yes/no confirmation gate.
- Say "no" and verify cancellation.

6. Auth blocker handling
- Force login/MFA/captcha during execution.
- Verify concise blocker summary is surfaced and no repeated retries.

7. Demo mode regression
- Record a short demo flow.
- Finalize and review.
- Save and confirm skill file creation under `skills/data/<domain>/`.

8. Optional ElevenLabs path
- Start app without ElevenLabs keys.
- Verify app still runs and execution/transcription are unaffected.
