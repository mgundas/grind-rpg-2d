import { useEffect } from "react";
import { GAME_NAME } from "@jadethrone/shared";
import { api } from "../network/api";
import { getHealth } from "../network/http";
import { logout } from "../network/session";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { BlacksmithWindow } from "./BlacksmithWindow";
import { BossTimer } from "./BossTimer";
import { BuffBar } from "./BuffBar";
import { CastBar } from "./CastBar";
import { AuthScreen } from "./AuthScreen";
import { CharacterSelect } from "./CharacterSelect";
import { CharacterWindow } from "./CharacterWindow";
import { SkillWindow } from "./SkillWindow";
import { Chat } from "./Chat";
import { DeathScreen } from "./DeathScreen";
import { DebugOverlay } from "./DebugOverlay";
import { Hotbar } from "./Hotbar";
import { Hud } from "./Hud";
import { InventoryWindow, useInventoryHotkey } from "./InventoryWindow";
import { PartyFrames } from "./PartyFrames";
import { PartyWindow } from "./PartyWindow";
import { NpcDialog } from "./NpcDialog";
import { PlayerContextMenu } from "./PlayerContextMenu";
import { FriendsWindow } from "./FriendsWindow";
import { Minimap } from "./Minimap";
import { WorldMapWindow } from "./WorldMapWindow";
import { GuildInvitePrompt, GuildWindow } from "./GuildWindow";
import { TradeWindow } from "./TradeWindow";
import { ShopWindow } from "./ShopWindow";
import { TargetFrame } from "./TargetFrame";
import { WarehouseWindow } from "./WarehouseWindow";
import { useUiStore } from "./store";
import { Panel, styles, theme } from "./theme";

const POLL_MS = 5000;

const STATUS_COLOR = {
  online: "#7ee08a",
  offline: "#ff7a6e",
  checking: "#9aa5a0",
} as const;

/**
 * Overlay root: server status, auth/character screens, and the in-game HUD.
 * `#overlay` is pointer-transparent; every interactive card opts back in.
 */
export function App() {
  const serverOnline = useUiStore((state) => state.serverOnline);
  const authPhase = useUiStore((state) => state.authPhase);
  const account = useUiStore((state) => state.account);
  const connectionPhase = useUiStore((state) => state.connectionPhase);
  const sessionKickedReason = useUiStore((state) => state.sessionKickedReason);
  useInventoryHotkey();

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const health = await getHealth();
      if (!cancelled) {
        useUiStore.getState().setServerOnline(health !== null);
      }
    };
    void probe();
    const timer = setInterval(() => void probe(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Restore a stored session once at boot. `restore` rotates the refresh token
  // and returns the current character list.
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const store = useUiStore.getState();
      if (!api.hasSession()) {
        store.setAnonymous();
        return;
      }
      try {
        const me = await api.restore();
        if (!cancelled) {
          store.setAuthenticated(me.account, me.characters);
        }
      } catch {
        if (!cancelled) {
          store.setAnonymous("Session expired. Sign in again.");
        }
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // A login elsewhere invalidates this session's tokens; return to the login
  // screen. A duplicate join keeps the tokens and shows the character list.
  useEffect(() => {
    if (sessionKickedReason === "login" || sessionKickedReason === "logout") {
      useUiStore
        .getState()
        .setAnonymous(
          sessionKickedReason === "login"
            ? "Signed in from another session."
            : "Logged out from another session.",
        );
    } else if (sessionKickedReason === "ban") {
      useUiStore.getState().setAnonymous("This account has been banned.");
    } else if (sessionKickedReason === "admin") {
      useUiStore.getState().setAuthError("You were removed from the game by an administrator.");
    }
  }, [sessionKickedReason]);

  const label = serverOnline === null ? "checking" : serverOnline ? "online" : "offline";
  const statusColor =
    serverOnline === null
      ? STATUS_COLOR.checking
      : serverOnline
        ? STATUS_COLOR.online
        : STATUS_COLOR.offline;

  const inGame = authPhase === "authenticated" && connectionPhase === "connected";

  return (
    <>
      <div style={{ position: "absolute", top: 12, left: 12 }}>
        <span
          style={{
            display: "inline-block",
            padding: "4px 10px",
            background: "rgba(16, 20, 19, 0.85)",
            border: "1px solid rgba(93, 168, 143, 0.4)",
            borderRadius: 6,
            fontFamily: "system-ui, sans-serif",
            fontSize: 12,
            color: "#cfd8d3",
            textShadow: "0 1px 2px rgba(0,0,0,0.5)",
          }}
        >
          {GAME_NAME} · server: <span style={{ color: statusColor }}>{label}</span>
          {inGame && account ? (
            <span style={{ color: theme.jade }}> · {account.username}</span>
          ) : null}
        </span>
      </div>

      {authPhase === "checking" ? (
        <Panel title={GAME_NAME} subtitle="Restoring session">
          <p style={{ textAlign: "center", fontSize: 12, color: theme.muted }}>
            Checking your saved session…
          </p>
        </Panel>
      ) : authPhase === "anonymous" ? (
        <AuthScreen />
      ) : inGame ? (
        <>
          <Hud />
          <Minimap />
          <WorldMapWindow />
          <Hotbar />
          <AnnouncementBanner />
          <BossTimer />
          <BuffBar />
          <CastBar />
          <TargetFrame />
          <CharacterWindow />
          <SkillWindow />
          <PartyWindow />
          <PartyFrames />
          <InventoryWindow />
          <NpcDialog />
          <BlacksmithWindow />
          <TradeWindow />
          <GuildWindow />
          <FriendsWindow />
          <GuildInvitePrompt />
          <PlayerContextMenu />
          <ShopWindow />
          <WarehouseWindow />
          <Chat />
          <DebugOverlay />
          <DeathScreen />
          <div style={{ position: "absolute", top: 12, right: 12 }}>
            <button type="button" onClick={() => void logout()} style={styles.ghostButton}>
              Log out
            </button>
          </div>
        </>
      ) : (
        <CharacterSelect />
      )}
    </>
  );
}
