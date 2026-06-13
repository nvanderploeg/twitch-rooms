/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only override for the Room Server WebSocket endpoint. */
  readonly VITE_ROOM_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
