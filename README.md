# Crash Game Client (PixiJS + React)

A production-style frontend foundation for a Crash game. The client is **not
authoritative**: it sends commands, renders authoritative server state, and predicts
only what is safe to predict (the visual curve between server ticks). For development
it talks to an in-browser **MockCrashServer** through the same transport abstraction
a real WebSocket backend will use.

> ⚠️ The mock server and its crash-point generator are development fixtures. They are
> not provably fair and must never be used for real-money play.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 — playable mock game + DevPanel
```

| Script                 | What it does                                   |
| ---------------------- | ---------------------------------------------- |
| `npm run dev`          | Vite dev server (StrictMode, DevPanel enabled) |
| `npm run build`        | Type-check (`tsc -b`) + production build       |
| `npm run preview`      | Serve the production build                     |
| `npm test`             | Vitest (logic tests, no browser needed)        |
| `npm run typecheck`    | TypeScript only                                |
| `npm run lint`         | ESLint                                         |
| `npm run format:check` | Prettier check (`npm run format` to fix)       |

Stack: Vite 8, React 19, TypeScript 6 (strict), PixiJS 8, Zustand 5, Vitest 5,
ESLint 10, Prettier 3. TypeScript is pinned to 6.0.x because `typescript-eslint` does
not support TypeScript 7 yet. No GSAP: all animation is PixiJS-ticker driven and
time-based.

---

## Architecture

```
            ┌──────────────── React (HTML UI) ────────────────┐
            │ BetPanel · History · Balance · ConnectionStatus │
            │ DevPanel (dev only) · GameCanvas (mount point)  │
            └───────▲───────────────────────────┬─────────────┘
          selectors │ (throttled)      commands │ placeBet() / cashOut()
                    │                           ▼
   ┌────────────────┴───────┐      ┌─────────────────────────┐
   │ Zustand stores          │◄─────│ GameController          │
   │ game · bet · player     │      │ (orchestration only)    │
   └─────────────────────────┘      │  • validates round ids  │
                                    │  • request ids/timeouts │
   ┌─────────────────────────┐      │  • snapshot resync      │
   │ RoundTimeline + GameClock│◄────│  • pure state machines  │
   └──────────▲──────────────┘      └───────────▲─────────────┘
    per-frame │ read-only                        │ typed ServerMessage
   ┌──────────┴──────────────┐      ┌───────────┴─────────────┐
   │ CrashGame (PixiJS)      │      │ WebSocketClient         │
   │ SceneManager · scenes   │      │ JSON · validation ·     │
   │ graph · aircraft · fx   │      │ status · reconnection   │
   └─────────────────────────┘      └───────────▲─────────────┘
                                                │ Transport (frames)
                                ┌───────────────┴───────────────┐
                                │ MockTransport → MockCrashServer│
                                │   or BrowserWebSocketTransport │
                                └────────────────────────────────┘
```

### Directory layout

```
src/
  app/            App, GameLayout, composition root (createGameSession), React hooks
  game/
    CrashGame.ts        Pixi Application lifecycle: init/start/pause/resume/resize/destroy
    GameController.ts   Network → stores/timeline; commands; resync
    core/               GameClock, RoundTimeline, SceneManager, ViewportManager, EventBus, layout
    scenes/             BaseScene, BettingScene, RunningScene, CrashedScene
    objects/            CrashGraph, MultiplierDisplay, Aircraft, Background, CrashEffect
    animation/          GraphAnimator (axis range), AircraftAnimator (pose)
  network/        protocol.ts (types), messages.ts (runtime validation), WebSocketClient,
                  ReconnectionManager, BrowserWebSocketTransport
  mock/           MockCrashServer, MockTransport, scenarios, devControls
  state/          roundMachine.ts, betMachine.ts (pure, tested)
  store/          gameStore, betStore, playerStore, history helpers, selectors
  components/     BetPanel, History, Balance, ConnectionStatus, GameCanvas, DevPanel
  services/       AudioManager (Web Audio placeholder synth)
  config/         gameConfig.ts (all tunables)
  types/          game.ts, bet.ts, network.ts
  utils/          money.ts, math.ts, time.ts, timers.ts, logger.ts, id.ts, visibility.ts
  tests/          Vitest suites
```

### Boundaries

| Layer              | Owns                                                        | Never does                                   |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------- |
| Server (mock/real) | crash point, round timing, bet acceptance, payouts, balance | —                                            |
| GameController     | turning messages into state, guarding/sending commands      | render, decide outcomes                      |
| RoundTimeline      | authoritative timing + display-multiplier prediction        | change round state on its own                |
| CrashGame / scenes | drawing what the timeline says, every frame                 | write state; call the network                |
| React              | forms, buttons, HTML overlays                               | touch Pixi objects; compute balances/payouts |

- Pixi objects are never stored in Zustand or React state.
- React gets **throttled** values (multiplier/countdown at ~10 Hz via
  `ui.storeUpdateIntervalMs`); Pixi renders every frame straight from `RoundTimeline`.
- The `EventBus` carries only fire-and-forget visual cues (`cashoutConfirmed`,
  `resynced`), not state.

---

## Round state machine

```
IDLE ──BETTING_STARTED──► BETTING ──ROUND_STARTING──► STARTING ──ROUND_STARTED──► RUNNING
  ▲                                                                                  │
  └───────────ROUND_FINISHED─────────── CRASHED ◄──────────ROUND_CRASHED─────────────┘
```

Only server messages move the round. `state/roundMachine.ts` classifies each event
for the current round:

- **advance**: the normal next step.
- **skip**: a forward jump (e.g. `ROUND_STARTING` was lost). It is still authoritative and applied.
- **duplicate** or **stale** (backwards): ignored.

Nothing in the renderer can crash a round. `if (display >= crashPoint) crash()` does
not exist anywhere, and the client never learns the crash point before `ROUND_CRASHED`.

## Bet state machine

```
NONE ─► PLACING ─► ACTIVE ─► CASHING_OUT ─► CASHED_OUT
          │          │            │
          ▼          ▼            ├─► ACTIVE (rejected, round still running)
       REJECTED     LOST          └─► LOST   (rejected: round crashed)
```

`state/betMachine.ts` is a pure reducer. When an event does not apply, it returns the
**same object**, so the controller can tell that the event was ignored. It never
applies a response whose `requestId` is unknown. A response for another round or bet
is also ignored.

Guards (`canPlaceBet`, `canCashOut`) block the following:

- betting outside `BETTING`
- betting while a bet is already live
- cashing out without an `ACTIVE` bet
- any command while disconnected or waiting for a snapshot

The UI disables the button in the same states. So a double click sends exactly one
request, and the second click is rejected by the guard even if it gets through.

Cash-out flow: click → `CASHING_OUT` (button disabled, "waiting for server") →
`CASHOUT_ACCEPTED` → `CASHED_OUT` with the **server's** multiplier and payout. The
"Potential" value is labelled as an estimate and never used as a payout.

---

## MockCrashServer

`src/mock/MockCrashServer.ts` behaves like a backend:

- Timed phases: BETTING (5 s) → STARTING (1 s) → RUNNING (ticks every 100 ms) →
  CRASHED (3 s) → IDLE (0.8 s) → next round. All durations are in
  `gameConfig.mockServer`.
- The multiplier is `m(t) = e^(growthRate·t)`, floored to 2 decimals. The crash time is
  `ln(crashPoint)/growthRate`, and the server checks it on every tick and cash-out.
- Validates every command: round id, phase, amount limits, funds, and duplicates.
  Requests are **idempotent by `requestId`**: a replayed request gets the original
  response and never causes a second debit.
- Owns a single wallet (integer minor units, starting at 1000.00). Every change is
  broadcast as `BALANCE_UPDATED` with a monotonic `version`.
- Keeps the last 20 results. `lastSettledBet` lets a client that reconnects late learn
  the outcome of its bet.

`MockTransport` serializes every frame to JSON and delivers it asynchronously. It can
add latency and drop messages in either direction, and it keeps each direction FIFO,
as a real socket does. It can also simulate the network going down.

## DevPanel (development only)

Open with the **DEV** tab on the right edge. It is rendered only when
`import.meta.env.DEV` is true and is lazy-loaded, so production builds contain no
DevPanel code. Every control acts on the mock directly, outside the game protocol:

- **Force next crash**: 1.01x, 1.10x, 1.50x, 2x, 5x, 10x, 50x or 100x. Each click
  queues one round. Named scenarios in `mock/scenarios.ts` queue several rounds.
- **Round**: _Start next round / skip wait_ skips the current wait (betting → starting
  → running, crashed → next betting). _Force crash now_ crashes at the current multiplier.
- **Connection**:
  - _Disconnect_ makes the network unreachable. The client goes to RECONNECTING and
    retries with backoff.
  - _Reconnect_ restores the network and reconnects immediately.
  - _Request snapshot_ forces a resync.
- **Latency**: 0 to 2000 ms each way. **Dropped messages**: 0, 5 or 20 %.

The crash point is drawn when betting opens, so a forced value applies to the **next**
round that opens. Also, with high latency the UI lags behind the mock server by the
latency you set: skipping phases from the panel can close betting before the client
sees it, and the server then (correctly) rejects the bet.

### Manual test script

1. `npm run dev`. The countdown runs ("PLACE YOUR BETS").
2. Set an amount (input or +1/+5/+10/½/x2) and press **BET** (or Space). The button
   shows "PLACING BET…", then "BET PLACED". The balance drops when the server sends
   `BALANCE_UPDATED`.
3. The round launches: the curve grows, the axes rescale, and the rocket follows the tip.
4. Press **CASH OUT**. The button shows "CASHING OUT…", then "CASHED OUT 1.xx x" with the
   server payout. A green marker appears on the curve and the balance increases.
5. The round crashes: explosion, red curve, final multiplier. History updates and the
   next round starts automatically.
6. In the DevPanel:
   - Queue `1.01x` to test instant busts.
   - Set 2000 ms latency: pending states stay visible for about 4 s.
   - Press _Disconnect_ mid-round, then _Reconnect_: the round continues from the
     server's current multiplier.

---

## Time, synchronization and prediction

- **GameClock** keeps three clocks separate:
  - local monotonic time (`performance.now()`)
  - estimated server time, which is local time plus an offset. The offset comes from
    NTP-style PING/PONG samples using the lowest-RTT sample, and corrections are slewed
    so the clock never jumps backwards.
  - round elapsed time.

  `Date.now()` is used only as the mock server's wall clock.

- **RoundTimeline** holds authoritative timing: betting deadline, `startedAt`,
  `growthRate`, the last tick, and the crash. Each frame, the renderer calls
  `sample(serverNow)`:
  - Display multiplier = `e^(rate · elapsed)`, where `elapsed` comes from the
    synchronized clock. It is independent of FPS, so the game behaves the same at
    30/60/120 Hz and after a background tab.
  - The prediction may run ahead of the last server tick only by the measured one-way
    delay plus a margin. If ticks stop (disconnect), the display freezes ("WAITING FOR
    SERVER…") instead of extrapolating stale state.
  - The display never shows less than an authoritative tick.
- Graph axes and aircraft heading use frame-rate independent damping
  (`1 - e^(-λ·dt)`).

## Reconnection and snapshots

1. The transport drops. `WebSocketClient` enters `RECONNECTING` and `ReconnectionManager`
   retries with exponential backoff and jitter. After `maxAttempts` failures the client
   enters `ERROR`.
2. On `CONNECTED`, the controller sends pings for clock sync and sends
   `REQUEST_SNAPSHOT` with a fresh `requestId`. It is in `syncing` mode until the
   snapshot arrives.
3. While syncing:
   - Commands are blocked.
   - Other state messages are ignored. The snapshot was produced after them and
     supersedes them.
   - Only the snapshot answering the **latest** request is applied.
4. `GameSnapshot` rebuilds everything:
   - round id and phase
   - timing (`bettingEndsAt`, `roundStartedAt`, `serverTime`, `currentMultiplier`)
   - crash data, but only after the crash
   - the player's bet, including its cash-out result
   - `lastSettledBet`, balance and version, history and bet limits

   The renderer is told to snap, and the animation continues from the server's state.

The client also requests snapshots in these cases:

- a bet or cash-out response times out
- it joins a round midway (for example, `BETTING_STARTED` was lost)
- a previous round's bet was never resolved
- the tab was hidden for more than 2 s

## Stale-message protection

- **Round ids**: finished rounds are retired. Any later message for them is ignored.
- **Unknown older rounds**: a message whose `serverTimestamp` is older than the latest
  applied lifecycle event is ignored. So a delayed `ROUND_CRASHED round-100` cannot
  touch `round-101`.
- **Request ids**: responses must match the pending `requestId`, and the round and bet
  must match too. Duplicate `BET_ACCEPTED` or `CASHOUT_ACCEPTED` messages do nothing.
- **Balance**: `BALANCE_UPDATED` is applied only if its `version` is newer.
- **Validation**: malformed JSON, unknown types, missing fields and non-integer money
  are logged (rate-limited) and dropped by `network/messages.ts`. One bad frame cannot
  crash the app.

All of this is covered in `src/tests/gameController.test.ts`.

## Money

All amounts are **integer minor units** (cents): `10.25 USD` is `1025`.

- `utils/money.ts` parses input strictly and formats with `Intl.NumberFormat`.
- `applyMultiplier` computes `floor(amount × hundredths / 100)` with integer math.
  The mock server uses it for payouts. The client uses it only for the "Potential"
  estimate.
- Balances shown are always the server's.

## Rendering and cleanup

- `CrashGame` creates one Pixi `Application` with `autoStart: false`, a non-shared
  ticker, and one ticker callback. `destroy()` removes the following:
  - the ticker callback
  - the ResizeObserver, the DPR media-query and visibility listeners
  - event-bus subscriptions
  - scenes and display objects, and the canvas itself

  If `destroy()` runs while `init()` is still awaiting, the app is torn down as soon as
  init finishes. Together with the effect cleanup in `GameCanvas`, this means React
  StrictMode's mount → unmount → mount leaves exactly one running instance.

- `ViewportManager` is the only code that measures the host (ResizeObserver plus DPR
  changes, coalesced per frame). Scenes receive a normalized `Viewport`/`Layout`.
  This handles:
  - desktop and mobile
  - portrait and landscape
  - iframes
  - zoom
- Graphics and text objects are created once. Per frame, the curve `Graphics` is
  cleared and redrawn, and redraws are skipped when nothing changed. Particles are
  pooled. `Texture.WHITE` is shared and never destroyed.
- The session (`createGameSession`) is side-effect free until `start()`. `stop()`
  releases timers, subscriptions, the connection and the mock server. A test runs 5
  start/stop cycles and asserts the timer count returns to baseline.

## Audio

`services/AudioManager.ts` synthesizes placeholder sounds with Web Audio:
round start, bet accepted, cash-out, crash, and a flight hum whose pitch follows the
multiplier. The AudioContext is created or resumed only after the first pointer or key
gesture (autoplay policy). Mute is persisted to `localStorage` with a try/catch.
Replace the `tone()` calls with sampled assets later. The `GameAudio` interface stays
the same.

---

## Replacing the mock with a real backend

The only code that knows which backend is used is `app/createGameSession.ts`:

```ts
if (config.network.websocketUrl) {
  transport = new BrowserWebSocketTransport(config.network.websocketUrl);
} else {
  server = new MockCrashServer();
  transport = new MockTransport(server);
}
```

To switch:

1. Set `VITE_WS_URL=wss://your-backend/ws` (e.g. in `.env.production`). The DevPanel's
   mock controls disappear automatically (`devControls` is `null`).
2. Make the backend speak `network/protocol.ts`:
   - JSON text frames
   - the same discriminated unions
   - `serverTimestamp` on every message
   - request ids echoed back
   - `PONG` for `PING`
   - `SNAPSHOT` for `REQUEST_SNAPSHOT`

   If the wire format differs, adapt it inside a custom `Transport` or in
   `messages.ts` only.

3. Add authentication. Pass a token in the URL or in a first frame, inside
   `BrowserWebSocketTransport` or a wrapper Transport. Add a `sessionId`/auth error
   handling path on `ERROR`.
4. Optionally, remove `mock/` from production bundles. It is only reachable through
   `createGameSession`.

`CrashGraph`, `Aircraft`, `BetPanel`, the stores, the state machines and
`GameController` do not change.

### Backend responsibilities (not the client's)

- Provably fair crash-point generation, for example a hash chain with a server seed and
  a client seed, published after each round.
- Authoritative timestamps for bet and cash-out acceptance, wallet transactions and
  idempotency keys.
- Rate limiting, authentication, and session resumption.

## Security and authority

- The client never computes or decides:
  - the crash point
  - bet acceptance
  - cash-out success
  - payout
  - balance
- The crash point is never sent before the crash. The mock snapshot enforces this, and
  there is a test for it.
- Displayed potential winnings are estimates. Only `CASHOUT_ACCEPTED` sets the result.
- Input from the network is validated. Input from the user is validated for UX only;
  the server re-validates everything.
- The DevPanel is excluded from production builds. The mock server is included **only**
  when `VITE_WS_URL` is not set (demo mode), and the UI shows a "MOCK SERVER" badge.

## Known limitations / next steps

- Single-player mock. There are no other players' bets or live bet list, and there is
  one bet per round (no auto-bet, auto-cash-out or multiple bet slots).
- The placeholder art is built from primitives, and the sounds are synthesized.
- The mock's random crash points are not provably fair (by design; it is a fixture).
- Pixi rendering is verified manually and with headless-browser smoke runs. Unit tests
  cover logic, not pixels.
- For a real backend, next:
  - authentication and session resume
  - server-provided currency and bet limits on `CONNECTED`
  - auto-cash-out executed server-side
  - a provably-fair verification UI
  - i18n
  - asset loading with `Assets`, plus a loading screen
