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
  x?: number;
  y?: number;
  map?: MapId;
}

/** Join (or create) the map room and wire connection status into the store. */
export async function connect(options: ConnectOptions): Promise<Room> {
  const ui = useUiStore.getState();
  ui.setConnectionPhase("connecting");
  ui.setConnectionError(null);
  try {
    const joined = await getClient().joinOrCreate(options.map ?? ROOM_NAME_VILLAGE, {
      name: options.name,
      kingdom: options.kingdom,
      x: options.x,
      y: options.y,
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
  }
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

export async function leave(): Promise<void> {
  if (!room) {
    return;
  }
  const current = room;
  room = null;
  await current.leave();
  useUiStore.getState().setConnectionPhase("left");
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
    useUiStore.getState().setConnectionPhase("error");
    useUiStore.getState().setConnectionError(message ?? `connection error ${code}`);
  });
  current.onLeave(() => {
    if (room === current) {
      room = null;
    }
    useUiStore.getState().setConnectionPhase("left");
  });
}
