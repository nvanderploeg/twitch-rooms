import { useEffect, useState } from 'react';
import type { ModuleType, RoomConfig } from '@twitch-room/protocol';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

/** Module types the panel can toggle. Keep in sync with the protocol union. */
const TOGGLEABLE_MODULES: ModuleType[] = ['avatars', 'emoteRain', 'polls', 'chatFeed'];

/**
 * Streamer config panel. Fetches the Room Config from the Room Server, renders
 * an editable form (theme, scene, module toggles), and saves via PUT. Auth is
 * the Room Server's streamer session; an unauthenticated load redirects to login.
 */
export function AdminPanel() {
  const [config, setConfig] = useState<RoomConfig | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch('/api/config', { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) {
          // TODO: redirect to the Room Server streamer login
          // (e.g. /auth/twitch/login?return=/admin).
          throw new Error('Not authenticated');
        }
        if (!res.ok) {
          throw new Error(`Failed to load config (${res.status})`);
        }
        return res.json() as Promise<RoomConfig>;
      })
      .then((cfg) => {
        if (!cancelled) {
          setConfig(cfg);
          setStatus('ready');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    if (!config) {
      return;
    }
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        throw new Error(`Save failed (${res.status})`);
      }
      setStatus('ready');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }

  function updateTheme(name: string) {
    setConfig((prev) => (prev ? { ...prev, theme: { ...prev.theme, name } } : prev));
  }

  function updateScene(name: string) {
    setConfig((prev) => (prev ? { ...prev, scene: { ...prev.scene, name } } : prev));
  }

  function toggleModule(type: ModuleType, enabled: boolean) {
    setConfig((prev) => {
      if (!prev) {
        return prev;
      }
      const existing = prev.modules.find((m) => m.type === type);
      const modules = existing
        ? prev.modules.map((m) => (m.type === type ? { ...m, enabled } : m))
        : [...prev.modules, { type, enabled, params: {} }];
      return { ...prev, modules };
    });
  }

  if (status === 'loading' || status === 'idle') {
    return <main style={styles.root}>Loading config…</main>;
  }
  if (!config) {
    return (
      <main style={styles.root}>
        <h1>Room Admin</h1>
        <p style={styles.error}>{error ?? 'Config unavailable.'}</p>
      </main>
    );
  }

  return (
    <main style={styles.root}>
      <h1>Room Admin — {config.channel}</h1>

      <label style={styles.field}>
        <span>Theme</span>
        <input
          value={config.theme.name}
          onChange={(e) => updateTheme(e.target.value)}
        />
      </label>

      <label style={styles.field}>
        <span>Scene</span>
        <input
          value={config.scene.name}
          onChange={(e) => updateScene(e.target.value)}
        />
      </label>

      <fieldset style={styles.fieldset}>
        <legend>Modules</legend>
        {TOGGLEABLE_MODULES.map((type) => {
          const enabled = config.modules.find((m) => m.type === type)?.enabled ?? false;
          return (
            <label key={type} style={styles.toggle}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => toggleModule(type, e.target.checked)}
              />
              <span>{type}</span>
            </label>
          );
        })}
      </fieldset>

      <button type="button" onClick={handleSave} disabled={status === 'saving'}>
        {status === 'saving' ? 'Saving…' : 'Save'}
      </button>
      {error ? <p style={styles.error}>{error}</p> : null}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    maxWidth: 480,
    margin: '0 auto',
    padding: 24,
    fontFamily: 'system-ui, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldset: { display: 'flex', flexDirection: 'column', gap: 8 },
  toggle: { display: 'flex', alignItems: 'center', gap: 8 },
  error: { color: '#d6455d' },
};
