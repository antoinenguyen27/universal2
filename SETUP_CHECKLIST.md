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
- Verify one transcript + one LangGraph response.

4. Multi-step work tool reasoning
- In Work mode, request a task requiring context + action (example: inspect page controls then perform an edit).
- Verify status stream shows multi-step execution (plan/tool loop) before final response.

5. Confirmation gate for irreversible actions
- Request a send/delete/publish/payment style action.
- Verify the agent asks for explicit yes/no before execution.
- Say "no" and verify cancellation.

6. Stop-word interrupt
- Run a long CUA task in Work mode.
- Say "stop" or "pause" while CUA is running.
- Verify interrupt status appears and task pauses.

7. Graph checkpoint continuity (same app run)
- Execute a first task that creates useful context.
- Issue a follow-up request that depends on prior context.
- Verify the second turn uses prior context without re-explaining everything.

8. Demo mode skill writing
- Stay in Demo mode, narrate a short workflow.
- Click End Demo & Review.
- Verify agent produces finalize/correction response, then save.
- Verify file in `skills/data/<domain>/<slug>.md`.

9. Tool failure recovery
- Trigger a blocked state (e.g., login wall).
- Verify agent reports blocker and concrete next action.

10. CUA execution via OpenRouter
- In Work mode, issue a reversible browser task.
- Verify status stream and successful completion using selected CUA model.
