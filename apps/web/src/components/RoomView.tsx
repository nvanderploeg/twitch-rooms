import { useEffect, useRef } from 'react';
import { Engine } from '../engine/Engine.js';
import { useRoom } from '../net/useRoom.js';

/**
 * The Viewer-facing scene. Mounts a Pixi canvas, drives the {@link Engine} from
 * the live Room config/state/chat, and overlays connection status plus the
 * Twitch login / claim affordance. Once the Viewer has claimed an avatar,
 * clicking the scene moves it.
 */
export function RoomView() {
  const { status, config, state, lastChat, claimedUserId, send } = useRoom();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);

  // Create / destroy the Engine when the config arrives or changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !config) {
      return;
    }
    let cancelled = false;
    const engine = new Engine();
    void engine.create(canvas, config).then(() => {
      if (cancelled) {
        engine.destroy();
        return;
      }
      engineRef.current = engine;
    });

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [config]);

  // Forward state snapshots to the Engine.
  useEffect(() => {
    if (state) {
      engineRef.current?.setState(state);
    }
  }, [state]);

  // Forward chat messages to the Engine.
  useEffect(() => {
    if (lastChat) {
      engineRef.current?.pushChat(lastChat);
    }
  }, [lastChat]);

  function handleLogin() {
    window.location.href = '/auth/viewer/login';
  }

  // When claimed, a click moves the avatar to the normalized click position.
  function handleSceneClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!claimedUserId) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    send({ type: 'action', action: { kind: 'move', x, y } });
  }

  const claimedName = claimedUserId
    ? (state?.avatars.find((a) => a.userId === claimedUserId)?.displayName ?? 'you')
    : null;

  return (
    <div style={styles.root}>
      <canvas
        ref={canvasRef}
        onClick={handleSceneClick}
        style={{ ...styles.canvas, cursor: claimedUserId ? 'crosshair' : 'default' }}
      />
      <div style={styles.overlay}>
        <header style={styles.header}>
          <h1 style={styles.title}>Twitch Room — web client</h1>
          {claimedName ? (
            <span style={styles.claimed}>Controlling: {claimedName} · click to move</span>
          ) : (
            <button type="button" onClick={handleLogin} style={styles.loginButton}>
              Log in with Twitch
            </button>
          )}
        </header>
        <div style={styles.status}>
          <StatusBadge status={status} />
          {config ? <span> · {config.channel}</span> : <span> · connecting to room…</span>}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === 'open' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected';
  return <span>{label}</span>;
}

const styles: Record<string, React.CSSProperties> = {
  root: { position: 'relative', width: '100%', height: '100vh', overflow: 'hidden' },
  canvas: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  overlay: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '12px 16px',
    color: '#e8e8e8',
    fontFamily: 'system-ui, sans-serif',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, margin: 0 },
  loginButton: { pointerEvents: 'auto', cursor: 'pointer' },
  claimed: { fontSize: 13, opacity: 0.9 },
  status: { fontSize: 13, opacity: 0.85 },
};
