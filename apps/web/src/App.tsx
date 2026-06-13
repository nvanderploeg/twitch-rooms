// Importing from the shared protocol package proves the workspace link resolves.
import { PROTOCOL_VERSION } from '@twitch-room/protocol';

// NOTE: rendering engine is PixiJS (ADR-0003). The real Engine that reads the
// Room Config and runs Modules replaces this placeholder component.
export function App() {
  return <h1 data-protocol-version={PROTOCOL_VERSION}>Twitch Room — web client</h1>;
}
