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

Push to `github.com/MotherOf-Pearl/tcg` `main`, then on `192.168.1.3`:

```
ssh root@192.168.1.3 'cd /mnt/user/appdata/onepiece-game && \
  curl -sO https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/server.js && \
  curl -sO https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/game.html && \
  curl -sO https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/index.html && \
  curl -sO https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/deck-editor.html && \
  curl -sO https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/background.js && \
  docker restart onepiece-game'
```

## Pre-deploy gate (HARD RULE)

**Do not `git push origin main` until both pass:**

1. `npm test` — all `node --test` files green.
2. e2e suite green (see `.claude/agents/e2e-test-agent.md`).

If either fails, fix it or surface the failure to the user — never push red.

## Agents

Specialized subagents in `.claude/agents/`. Invoke by name when the work matches:

- **solution-architect-agent** — designs the approach BEFORE code is written. Hard constraint: scalability — every design must generalize to all cards/abilities/keywords. Invoke first for any non-trivial change.
- **coding-agent** — implements features/bugfixes per the architect's design. Default for code changes.
- **unit-test-agent** — writes and runs `node --test` files.
- **e2e-test-agent** — spins server + two WS clients, runs full game flows.
- **ui-test-agent** — Playwright against `game.html` / `deck-editor.html`.
- **rules-compliance-agent** — cross-checks player workflows against `rule_comprehensive.pdf` and `rule_manual.pdf`.

**Workflow for non-trivial work:** solution-architect-agent → coding-agent → unit-test-agent → e2e-test-agent → (rules-compliance-agent for rules-sensitive changes) → push. Before pushing to prod, unit-test-agent and e2e-test-agent must be green. For rules-sensitive changes (new card, phase logic, win condition), also run rules-compliance-agent.
