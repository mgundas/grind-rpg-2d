import { Client, type Room } from "@colyseus/sdk";
import {
  MSG,
  SESSION_KICK_CODE,
  type InputMessage,
  type MapId,
  type SessionKickedPayload,
  type WarpPayload,
} from "@jadethrone/shared";
import { useUiStore } from "../ui/store";
import { ApiError, api } from "./api";
import { tokens } from "./tokens";

/**
 * Colyseus session lifecycle for the client. One room at a time; scenes read
 * the room through `getRoom()` and register state/message handlers.
 *
 * The access token is attached with `client.auth.token`, which the SDK forwards
 * as `Authorization: Bearer` on matchmaking and `_authToken` on the WebSocket.
 */

let sdk: Client | null = null;
let room: Room | null = null;
let connectPromise: Promise<Room> | null = null;

function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (configured) {
    return configured;
  }
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.hostname}:2567`;
}

export function getClient(): Client {
  sdk ??= new Client(serverUrl());
  return sdk;
}

export function getRoom(): Room | null {
  return room;
}

export function getSessionId(): string | null {
  return room?.sessionId ?? null;
}

export interface ConnectOptions {
  characterId: string;
  map: MapId;
}

async function attemptJoin(client: Client, characterId: string, map: MapId): Promise<Room> {
  const access = tokens.getAccess();
  if (access) {
    client.auth.token = access;
  }
  return client.joinOrCreate(map, { characterId, map });
}

/** Join the character's saved map; one refresh/character-list retry on failure. */
export async function connect(options: ConnectOptions): Promise<Room> {
  if (connectPromise) {
    return connectPromise;
  }
  if (room) {
    // A previous failed attempt may have left a socket; never join a second
    // room on top of it (the server would kick the old session later anyway).
    await leave({ silent: true });
  }
  const ui = useUiStore.getState();
  ui.setConnectionPhase("connecting");
  ui.setConnectionError(null);
  ui.setChatFocused(false);
  ui.setMapId(options.map);

  connectPromise = (async () => {
    try {
      const client = getClient();
      let joined: Room;
      try {
        joined = await attemptJoin(client, options.characterId, options.map);
      } catch (firstError) {
        // The access token may have expired, or the character may have changed
        // maps in another tab. `/me` refreshes the token and reloads characters.
        const me = await api.me();
        useUiStore.getState().setCharacters(me.characters);
        const character = me.characters.find((candidate) => candidate.id === options.characterId);
        if (!character) {
          throw firstError;
        }
        useUiStore.getState().setMapId(character.map);
        joined = await attemptJoin(client, character.id, character.map);
      }

      room = joined;
      bindSessionEvents(joined);
      const store = useUiStore.getState();
      store.setSessionKicked(null);
      store.setSessionId(joined.sessionId);
      store.setConnectionPhase("connected");
      return joined;
    } catch (error) {
      const store = useUiStore.getState();
      if (error instanceof ApiError && (error.code === "unauthorized" || error.status === 401)) {
        tokens.clear();
        store.setAnonymous("Session expired. Sign in again.");
      } else {
        store.setConnectionPhase("error");
        store.setConnectionError(String(error));
      }
      throw error;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

/** Consume a warp reservation and make the new room current. */
export async function consumeWarp(payload: WarpPayload): Promise<Room> {
  const next = await getClient().consumeSeatReservation(payload.reservation);
  room = next;
  bindSessionEvents(next);
  const store = useUiStore.getState();
  store.setSessionKicked(null);
  store.setSessionId(next.sessionId);
  store.setMapId(payload.map);
  store.setConnectionPhase("connected");
  return next;
}

export async function leave(options: { silent?: boolean } = {}): Promise<void> {
  const current = room;
  room = null;
  useUiStore.getState().setChatFocused(false);
  if (!current) {
    return;
  }
  await current.leave();
  if (!options.silent) {
    useUiStore.getState().setConnectionPhase("left");
  }
}

/** Leave (saving the position), revoke the refresh token, return to login. */
export async function logout(): Promise<void> {
  try {
    await leave({ silent: true });
  } catch {
    // The socket may already be gone; local cleanup still proceeds.
  }
  try {
    await api.logout();
  } catch {
    // The local session is cleared regardless of network/server errors.
  }
  const store = useUiStore.getState();
  store.setSessionKicked(null);
  store.setAnonymous();
}

export function sendInput(message: InputMessage): void {
  room?.send(MSG.input, message);
}

export function sendChat(text: string): void {
  room?.send(MSG.chat, { text });
}

function bindSessionEvents(current: Room): void {
  current.onError((code, message) => {
    if (room !== current) {
      return;
    }
    const store = useUiStore.getState();
    store.setChatFocused(false);
    store.setConnectionPhase("error");
    store.setConnectionError(message ?? `connection error ${code}`);
  });

  current.onMessage(MSG.sessionKicked, (payload: SessionKickedPayload) => {
    const store = useUiStore.getState();
    store.setSessionKicked(payload.reason);
    if (payload.reason !== "duplicate") {
      // Login/logout bumped the token version; these tokens are dead.
      tokens.clear();
    }
    store.setConnectionPhase("left");
  });

  current.onLeave((code) => {
    if (room === current) {
      room = null;
      const store = useUiStore.getState();
      store.setChatFocused(false);
      store.setConnectionPhase("left");
      // The message can be lost; the close code is the fallback. Keep tokens
      // (a duplicate join here is not a credential problem).
      if (code === SESSION_KICK_CODE && !useUiStore.getState().sessionKickedReason) {
        useUiStore.getState().setSessionKicked("duplicate");
      }
    }
    if (pingRoom === current) {
      stopPingLoop();
    }
  });

  startPingLoop(current);
}

let pingTimer: ReturnType<typeof setInterval> | null = null;
let pingRoom: Room | null = null;
let pingMs = 0;

function startPingLoop(current: Room): void {
  stopPingLoop();
  pingRoom = current;
  pingMs = 0;
  const measure = () => {
    current.ping((ms) => {
      pingMs = pingMs === 0 ? ms : pingMs * 0.7 + ms * 0.3;
    });
  };
  measure();
  pingTimer = setInterval(measure, 2000);
}

function stopPingLoop(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  pingRoom = null;
}

/** Smoothed round-trip time in ms for the F3 overlay (0 until first pong). */
export function getPingMs(): number {
  return Math.round(pingMs);
}
