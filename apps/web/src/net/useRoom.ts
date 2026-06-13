import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChatMessage,
  ClientMessage,
  RoomConfig,
  RoomState,
  ServerMessage,
} from '@twitch-room/protocol';
import { RoomConnection } from './connection.js';
import type { ConnectionStatus } from './connection.js';

export interface UseRoomResult {
  status: ConnectionStatus;
  config: RoomConfig | null;
  state: RoomState | null;
  lastChat: ChatMessage | null;
  send: (msg: ClientMessage) => void;
}

/**
 * React hook wrapping a {@link RoomConnection}. Owns one connection for the
 * lifetime of the component and exposes the latest config/state/chat plus a
 * `send` for client messages.
 */
export function useRoom(): UseRoomResult {
  const connectionRef = useRef<RoomConnection | null>(null);
  if (connectionRef.current === null) {
    connectionRef.current = new RoomConnection();
  }
  const connection = connectionRef.current;

  const [status, setStatus] = useState<ConnectionStatus>(connection.getStatus());
  const [config, setConfig] = useState<RoomConfig | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [lastChat, setLastChat] = useState<ChatMessage | null>(null);

  useEffect(() => {
    const offStatus = connection.onStatus(setStatus);
    const offMessage = connection.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'welcome':
          setConfig(msg.config);
          setState(msg.state);
          break;
        case 'state':
          setState(msg.state);
          break;
        case 'chat':
          setLastChat(msg.message);
          break;
        case 'error':
          // TODO: surface server-reported errors to the UI.
          break;
      }
    });

    connection.connect();

    return () => {
      offStatus();
      offMessage();
      connection.close();
    };
  }, [connection]);

  const send = useMemo(() => connection.send.bind(connection), [connection]);

  return { status, config, state, lastChat, send };
}
