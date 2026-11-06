import { Client, type Room } from "@colyseus/sdk";
import {
  ROOM_NAME_VILLAGE,
  type ChatMsgPayload,
  type InputMessage,
  type MapId,
  type WarpPayload,
} from "@jadethrone/shared";
import { useUiStore } from "../ui/store";

/**
 * Colyseus session lifecycle for the client. One room at a time; scenes read
 * the room through `getRoom()` and register state/message handlers.
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
  name: string;
  kingdom: string;
  map?: MapId;
}

/** Join (or create) the map room and wire connection status into the store. */
export async function connect(options: ConnectOptions): Promise<Room> {
  if (connectPromise) {
    return connectPromise;
  }
  const ui = useUiStore.getState();
  const map = options.map ?? ui.mapId ?? ROOM_NAME_VILLAGE;
  ui.setConnectionPhase("connecting");
  ui.setConnectionError(null);
  ui.setChatFocused(false);
  ui.setMapId(map);

  connectPromise = (async () => {
    try {
      const joined = await getClient().joinOrCreate(map, {
        name: options.name,
        kingdom: options.kingdom,
      });
      room = joined;
      bindSessionEvents(joined);
      useUiStore.getState().setSessionId(joined.sessionId);
      useUiStore.getState().setConnectionPhase("connected");
      return joined;
    } catch (error) {
      useUiStore.getState().setConnectionPhase("error");
      useUiStore.getState().setConnectionError(String(error));
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
  useUiStore.getState().setSessionId(next.sessionId);
  useUiStore.getState().setMapId(payload.map);
  useUiStore.getState().setConnectionPhase("connected");
  return next;
}

export async function leave(options: { silent?: boolean } = {}): Promise<void> {
  if (!room) {
    return;
  }
  const current = room;
  room = null;
  useUiStore.getState().setChatFocused(false);
  await current.leave();
  if (!options.silent) {
    useUiStore.getState().setConnectionPhase("left");
  }
}

export function sendInput(message: InputMessage): void {
  room?.send("input", message);
}

export function sendChat(text: string): void {
  room?.send("chat", { text });
}

export function onChatMessage(handler: (payload: ChatMsgPayload) => void): () => void {
  if (!room) {
    return () => undefined;
  }
  return room.onMessage("chatMsg", handler);
}

function bindSessionEvents(current: Room): void {
  current.onError((code, message) => {
    if (room !== current) {
      return;
    }
    useUiStore.getState().setChatFocused(false);
    useUiStore.getState().setConnectionPhase("error");
    useUiStore.getState().setConnectionError(message ?? `connection error ${code}`);
  });
  current.onLeave(() => {
    const unexpected = room === current;
    if (unexpected) {
      room = null;
      useUiStore.getState().setChatFocused(false);
      useUiStore.getState().setConnectionPhase("left");
    }
    stopPingLoop();
  });
  startPingLoop(current);
}

let pingTimer: ReturnType<typeof setInterval> | null = null;
let pingMs = 0;

function startPingLoop(current: Room): void {
  stopPingLoop();
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
}

/** Smoothed round-trip time in ms for the F3 overlay (0 until first pong). */
export function getPingMs(): number {
  return Math.round(pingMs);
}
