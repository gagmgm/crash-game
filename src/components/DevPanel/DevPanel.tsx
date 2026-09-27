import { useEffect, useReducer, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameSession, useGameStore } from '../../app/session';
import { gameConfig } from '../../config/gameConfig';
import { CRASH_SCENARIOS, FORCED_CRASH_PRESETS } from '../../mock/scenarios';
import styles from './DevPanel.module.css';

/**
 * DEVELOPMENT ONLY — never rendered in production builds (see GameLayout).
 * Drives the mock server/transport directly to test edge cases. None of these controls
 * exist in the real client/server protocol.
 */
export default function DevPanel() {
  const { devControls: dev, controller } = useGameSession();
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 1200px)').matches);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const info = useGameStore(
    useShallow((s) => ({
      roundId: s.roundId,
      roundState: s.roundState,
      status: s.connectionStatus,
      syncing: s.syncing,
      rttMs: s.rttMs,
    })),
  );

  // Mock state (queue, latency) lives outside React; poll it cheaply while visible.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(refresh, 500);
    return () => clearInterval(id);
  }, [open]);

  const act = (fn: () => void) => () => {
    fn();
    refresh();
  };

  return (
    <>
      <button type="button" className={styles.toggle} onClick={() => setOpen((v) => !v)}>
        {open ? 'CLOSE DEV' : 'DEV'}
      </button>
      {open && (
        <aside className={styles.panel} aria-label="Developer panel (mock/test only)">
          <h2 className={styles.title}>DEV PANEL · MOCK / TEST ONLY</h2>
          <p className={styles.disclaimer}>
            Forces outcomes on the in-browser mock server. Not available with a real backend.
          </p>

          <dl className={styles.info}>
            <dt>Round</dt>
            <dd>
              {info.roundId ?? '—'} · {info.roundState}
            </dd>
            <dt>Connection</dt>
            <dd>
              {info.status}
              {info.syncing ? ' · syncing' : ''}
              {info.rttMs !== null ? ` · rtt ${Math.round(info.rttMs)}ms` : ''}
            </dd>
            {dev && (
              <>
                <dt>Forced queue</dt>
                <dd>
                  {dev.forcedQueue().length
                    ? dev
                        .forcedQueue()
                        .map((m) => `${m}x`)
                        .join(', ')
                    : 'random'}
                </dd>
              </>
            )}
          </dl>

          {dev && (
            <>
              <div className={styles.group}>
                <h3 className={styles.groupTitle}>FORCE NEXT CRASH</h3>
                <div className={styles.row}>
                  {FORCED_CRASH_PRESETS.map((m) => (
                    <button key={m} type="button" onClick={act(() => dev.forceNextCrash(m))}>
                      {m.toFixed(2)}x
                    </button>
                  ))}
                </div>
                <div className={styles.row} style={{ marginTop: 6 }}>
                  <select
                    aria-label="Queue scenario"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) dev.queueScenario(e.target.value);
                      e.target.value = '';
                      refresh();
                    }}
                  >
                    <option value="">Queue scenario…</option>
                    {CRASH_SCENARIOS.filter(
                      (s) => s.crashPoints.length > 1 || s.crashPoints[0]! > 100,
                    ).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={act(dev.clearForcedCrashes)}>
                    Clear queue
                  </button>
                </div>
              </div>

              <div className={styles.group}>
                <h3 className={styles.groupTitle}>ROUND</h3>
                <div className={styles.row}>
                  <button type="button" onClick={act(dev.startNextRound)}>
                    Start next round / skip wait
                  </button>
                  <button type="button" className={styles.danger} onClick={act(dev.forceCrash)}>
                    Force crash now
                  </button>
                </div>
              </div>
            </>
          )}

          <div className={styles.group}>
            <h3 className={styles.groupTitle}>CONNECTION</h3>
            <div className={styles.row}>
              {dev && (
                <button type="button" className={styles.danger} onClick={act(dev.goOffline)}>
                  Disconnect
                </button>
              )}
              <button
                type="button"
                onClick={act(() => {
                  dev?.goOnline();
                  controller.reconnect();
                })}
              >
                Reconnect
              </button>
              <button type="button" onClick={act(() => controller.requestSnapshot('dev panel'))}>
                Request snapshot
              </button>
            </div>
          </div>

          {dev && (
            <>
              <div className={styles.group}>
                <h3 className={styles.groupTitle}>SIMULATED LATENCY (each way)</h3>
                <div className={styles.row}>
                  {gameConfig.mockNetwork.latencyOptionsMs.map((ms) => (
                    <button
                      key={ms}
                      type="button"
                      aria-pressed={dev.latency() === ms}
                      onClick={act(() => dev.setLatency(ms))}
                    >
                      {ms}ms
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.group}>
                <h3 className={styles.groupTitle}>DROPPED MESSAGES</h3>
                <div className={styles.row}>
                  {gameConfig.mockNetwork.dropRateOptions.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      aria-pressed={dev.dropRate() === rate}
                      onClick={act(() => dev.setDropRate(rate))}
                    >
                      {Math.round(rate * 100)}%
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>
      )}
    </>
  );
}
