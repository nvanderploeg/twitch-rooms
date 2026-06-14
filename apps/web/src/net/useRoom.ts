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
  /** The Twitch user id of the avatar this client controls, or null if anonymous. */
  claimedUserId: string | null;
  send: (msg: ClientMessage) => void;
}

/**
 * Read a `claim_token` handed to the SPA via the redirect fragment
 * (`/#claim_token=...`) after the Viewer login, then strip it from the URL so a
 * refresh or shared link can't replay the single-use token.
 */
function readClaimTokenFromHash(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const match = /(?:^|[#&])claim_token=([^&]+)/.exec(window.location.hash);
  if (!match) {
    return null;
  }
  const token = decodeURIComponent(match[1]!);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}

/**
 * React hook wrapping a {@link RoomConnection}. Owns one connection for the
 * lifetime of the component and exposes the latest config/state/chat, the
 * claimed avatar id, and a `send` for client messages. If the page loaded with a
 * claim token, it is sent once the connection opens.
 */
export function useRoom(): UseRoomResult {
  const connectionRef = useRef<RoomConnection | null>(null);
  if (connectionRef.current === null) {
    connectionRef.current = new RoomConnection();
  }
  const connection = connectionRef.current;

  // One-time capture of the claim token from the URL fragment.
  const claimTokenRef = useRef<{ token: string | null } | null>(null);
  if (claimTokenRef.current === null) {
    claimTokenRef.current = { token: readClaimTokenFromHash() };
  }

  const [status, setStatus] = useState<ConnectionStatus>(connection.getStatus());
  const [config, setConfig] = useState<RoomConfig | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [lastChat, setLastChat] = useState<ChatMessage | null>(null);
  const [claimedUserId, setClaimedUserId] = useState<string | null>(null);

  useEffect(() => {
    const offStatus = connection.onStatus(setStatus);
    const offMessage = connection.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'welcome':
          setConfig(msg.config);
          setState(msg.state);
          setClaimedUserId(msg.claimedUserId);
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

  // Once open, redeem a pending claim token exactly once.
  useEffect(() => {
    const pending = claimTokenRef.current;
    if (status === 'open' && pending?.token) {
      connection.send({ type: 'claim', token: pending.token });
      pending.token = null;
    }
  }, [status, connection]);

  const send = useMemo(() => connection.send.bind(connection), [connection]);

  return { status, config, state, lastChat, claimedUserId, send };
}
