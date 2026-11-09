import { useEffect, useState } from "react";
import { useUiStore } from "./store";
import {
  KEYBIND_ACTIONS,
  KEYBIND_LABELS,
  displayKey,
  findKeyConflict,
  isTypingTarget,
  matchesKeybind,
  normalizeKey,
  type KeybindAction,
} from "./keybinds";
import { theme } from "./theme";
import { Window } from "./Window";

const CAPTURE_HINT = "Press a key… (Esc to cancel)";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 14 }}>
      <div
        style={{
          color: theme.gold,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1,
          marginBottom: 7,
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gap: 7 }}>{children}</div>
    </section>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
      <span style={{ width: 58, color: theme.muted }}>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        style={{ flex: 1, accentColor: theme.jade }}
      />
      <span style={{ width: 34, textAlign: "right", color: theme.textStrong }}>
        {Math.round(value * 100)}%
      </span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        fontSize: 11,
        color: theme.muted,
      }}
    >
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        style={{ accentColor: theme.jade }}
      />
    </label>
  );
}

/** Settings window: audio, display, camera and key rebinding (§10.4). */
export function SettingsWindow() {
  const open = useUiStore((state) => state.settingsOpen);
  const settings = useUiStore((state) => state.settings);
  const updateSettings = useUiStore((state) => state.updateSettings);
  const resetSettings = useUiStore((state) => state.resetSettings);
  const setOpen = useUiStore((state) => state.setSettingsOpen);
  const [capturing, setCapturing] = useState<KeybindAction | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const store = useUiStore.getState();
      if (event.key === "Escape" && store.settingsOpen) {
        if (!isTypingTarget(event.target)) {
          store.setSettingsOpen(false);
        }
        return;
      }
      if (
        !store.chatFocused &&
        !isTypingTarget(event.target) &&
        matchesKeybind(store.settings.keybinds, event, "settings")
      ) {
        event.preventDefault();
        store.toggleSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!capturing) {
      return;
    }
    const onCapture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        setCapturing(null);
        setConflict(null);
        return;
      }
      const key = normalizeKey(event.key);
      if (key.startsWith("arrow") && !capturing.startsWith("move")) {
        setConflict("Arrow keys are reserved as movement alternates. Choose another key.");
        return;
      }
      const conflictAction = findKeyConflict(settings.keybinds, key, capturing);
      if (conflictAction) {
        setConflict(
          `${displayKey(key)} is already bound to "${KEYBIND_LABELS[conflictAction]}". Choose another key.`,
        );
        return;
      }
      updateSettings({ keybinds: { ...settings.keybinds, [capturing]: key } });
      setCapturing(null);
      setConflict(null);
    };
    window.addEventListener("keydown", onCapture, { capture: true });
    return () => window.removeEventListener("keydown", onCapture, { capture: true });
  }, [capturing, settings.keybinds, updateSettings]);

  if (!open) {
    return null;
  }

  return (
    <Window id="settings" title="Settings" width={340} onClose={() => setOpen(false)}>
      <Section title="Audio">
        <Toggle
          label="Mute all"
          checked={settings.muted}
          onChange={(muted) => updateSettings({ muted })}
        />
        <Slider
          label="Master"
          value={settings.masterVolume}
          onChange={(masterVolume) => updateSettings({ masterVolume })}
        />
        <Slider
          label="Music"
          value={settings.musicVolume}
          onChange={(musicVolume) => updateSettings({ musicVolume })}
        />
        <Slider
          label="Effects"
          value={settings.sfxVolume}
          onChange={(sfxVolume) => updateSettings({ sfxVolume })}
        />
      </Section>

      <Section title="Display">
        <Toggle
          label="Show names"
          checked={settings.showNames}
          onChange={(showNames) => updateSettings({ showNames })}
        />
        <Toggle
          label="Damage numbers"
          checked={settings.showDamageNumbers}
          onChange={(showDamageNumbers) => updateSettings({ showDamageNumbers })}
        />
        <Toggle
          label="Day / night"
          checked={settings.dayNightEnabled}
          onChange={(dayNightEnabled) => updateSettings({ dayNightEnabled })}
        />
        <Toggle
          label="Weather"
          checked={settings.weatherEnabled}
          onChange={(weatherEnabled) => updateSettings({ weatherEnabled })}
        />
        <Toggle
          label="Screen shake"
          checked={settings.screenShakeEnabled}
          onChange={(screenShakeEnabled) => updateSettings({ screenShakeEnabled })}
        />
        <label style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <span style={{ color: theme.muted }}>Camera zoom</span>
          <select
            value={settings.zoom}
            onChange={(event) =>
              updateSettings({ zoom: Number(event.target.value) as 1 | 2 | 3 })
            }
            style={{
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid rgba(93,168,143,0.4)",
              background: "#0e1311",
              color: theme.text,
              fontSize: 11,
            }}
          >
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={3}>3×</option>
          </select>
        </label>
      </Section>

      <Section title="Keys">
        {conflict ? (
          <div style={{ color: theme.danger, fontSize: 10 }}>{conflict}</div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
          {KEYBIND_ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                setConflict(null);
                setCapturing(action);
              }}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 6,
                padding: "3px 6px",
                borderRadius: 4,
                border: `1px solid ${
                  capturing === action ? theme.gold : "rgba(255,255,255,0.12)"
                }`,
                background: capturing === action ? "rgba(201,162,39,0.12)" : "transparent",
                color: theme.text,
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              <span style={{ color: theme.muted }}>{KEYBIND_LABELS[action]}</span>
              <span style={{ color: theme.gold, fontWeight: 700 }}>
                {capturing === action ? CAPTURE_HINT : displayKey(settings.keybinds[action])}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            resetSettings();
            setCapturing(null);
            setConflict(null);
          }}
          style={{
            marginTop: 4,
            padding: "4px 8px",
            borderRadius: 4,
            border: `1px solid ${theme.jade}`,
            background: "transparent",
            color: theme.jade,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Reset all settings
        </button>
        <button
          type="button"
          onClick={() => {
            useUiStore.getState().setCreditsOpen(true);
            setOpen(false);
          }}
          style={{
            marginTop: 4,
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "transparent",
            color: theme.muted,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Credits & licenses
        </button>
      </Section>
    </Window>
  );
}
