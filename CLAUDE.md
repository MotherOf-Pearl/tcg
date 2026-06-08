# BoohawTCG (OPTCG engine)

Node WebSocket card game. Custom Boohaw card set running on a One Piece TCG-style engine.

## Layout

- `server.js` — single-file Node server (~344KB). HTTP statics + WebSocket game loop + card DB + pipeline runtime. The `/\.js$/` route serves any `*.js` from BASE_DIR with `no-cache`.
- `game.html` — in-browser client (~236KB). All game UI lives here.
- `deck-editor.html` — deck builder UI.
- `background.js` — client-side helpers, served via the wildcard JS route.
- `index.html` — landing/lobby.
- `tests/` — `node --test` unit tests. Card behavior lives in `pipeline_<card>.test.js`; engine/phase coverage in `trackP_*`, `phase*_batch*`, etc. Shared fixtures in `tests/helpers.js`.
- `docs/rules/` — **living rules reference**. `rule_comprehensive.pdf` (full mechanics) and `rule_manual.pdf` (player-facing). Versioned in git — this is the source of truth, not the OneDrive copy. All agents reference these via the repo path.
- `OP01..OP11`, `ST01..ST22`, `EB01..EB02`, `P`, `Don`, `PRB01` — card art subfolders.
- `audio/`, `backgrounds/` — static assets.

## Card pipeline

Cards opt into the new engine with `useNewPipeline: true` in `CARD_DB`. Behavior runs through `srv.runPipeline('<trigger>', game, playerId, card)`. Interactive windows (e.g. `restTargetWindow`, `koTargetWindow`) stash a `pipelineResume` so chained steps fire after the player responds via `handleAction(roomId, playerId, { type: '...' })`.

When adding a card, follow the pattern in `tests/pipeline_anna_of_brittany.test.js` — assert the card is registered, assert the window opens with the right candidates, simulate the selection action, assert the post-resume state.

## Deploy

Push to `github.com/MotherOf-Pearl/tcg` `main`. `192.168.1.3` pulls within 60s via cron and restarts the container only on actual change. No manual step.

```
git push origin main
```

Watch `/mnt/user/appdata/onepiece-game/auto-deploy.log` if anything looks wrong.

### One-time setup on 192.168.1.3 (enables auto-deploy)

```
# Replace curl-fetched dir with a proper git clone
cd /mnt/user/appdata
mv onepiece-game onepiece-game.bak
git clone https://github.com/MotherOf-Pearl/tcg.git onepiece-game
# If the container needs node_modules from the old dir:
cp -r onepiece-game.bak/node_modules onepiece-game/ 2>/dev/null || true
chmod +x onepiece-game/auto-deploy.sh
docker restart onepiece-game   # confirm it boots from the cloned layout

# Install cron
(crontab -l 2>/dev/null; echo "* * * * * /mnt/user/appdata/onepiece-game/auto-deploy.sh") | crontab -
```

`auto-deploy.sh` ships in repo root. After verification, `rm -rf onepiece-game.bak`.

## Pre-deploy gate (HARD RULE)

**Do not `git push origin main` until both pass:**

1. `npm test` — all `node --test` files green.
2. e2e suite green (see `.claude/agents/e2e-test-agent.md`).

If either fails, fix it or surface the failure to the user — never push red.

## Agents

Specialized subagents in `.claude/agents/`. Invoke by name when the work matches:

- **bug-diagnoser-agent** — reproduces, traces, and root-causes bugs BEFORE a fix is designed. **MANDATORY first step on any bug-fix workflow** — never skip, even on "obvious" bugs. Outputs `docs/diagnoses/<slug>.md`. Symptom ≠ root cause; this agent enforces the distinction.
- **solution-architect-agent** — designs the approach BEFORE code is written. Hard constraint: scalability — every design must generalize to all cards/abilities/keywords. Invoke first for any non-bug-fix work.
- **coding-agent** — implements features/bugfixes per the architect's design. Default for code changes.
- **unit-test-agent** — writes and runs `node --test` files.
- **e2e-test-agent** — spins server + two WS clients, runs full game flows.
- **ui-test-agent** — Playwright against `game.html` / `deck-editor.html`.
- **rules-compliance-agent** — cross-checks player workflows against `rule_comprehensive.pdf` and `rule_manual.pdf`.

**Workflow for bug fixes (HARD RULE):**
bug-diagnoser-agent → solution-architect-agent → coding-agent → unit-test-agent → e2e-test-agent → (rules-compliance-agent for rules-sensitive changes) → push.

The bug-diagnoser step is non-negotiable. Diagnosing through a dedicated read-only agent before designing prevents symptom-patching, surfaces adjacent bugs grep can find, and keeps the architect designing against the real problem instead of the user's framing of it.

**Workflow for new features (no bug-fix involved):**
solution-architect-agent → coding-agent → unit-test-agent → e2e-test-agent → (rules-compliance-agent for rules-sensitive changes) → push.

Before pushing to prod, unit-test-agent and e2e-test-agent must be green. For rules-sensitive changes (new card, phase logic, win condition), also run rules-compliance-agent.
