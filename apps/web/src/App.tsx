// Importing from the shared protocol package proves the workspace link resolves.
import type { Placeholder } from '@twitch-room/protocol';

// TODO(decision pending): graphics/rendering engine for the Room (2D vs 3D) is
// undecided — no rendering engine is wired up yet. For now this is plain text.

const _placeholder: Placeholder = { type: 'placeholder' };

export function App() {
  return <h1>Twitch Room — web client</h1>;
}
