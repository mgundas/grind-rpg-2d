import { useEffect, useState } from "react";
import { useUiStore } from "./store";
import { theme } from "./theme";
import { Window } from "./Window";

/**
 * Credits screen (GAME_DESIGN.md §2.1). Reads `assets/CREDITS.md` at runtime so
 * attribution lives with the assets; the bundled file also acts as the
 * fallback when the network copy is unavailable.
 */

const FALLBACK = `# Asset Credits

Credits could not be loaded. See assets/CREDITS.md in the game files.`;

function renderLines(text: string) {
  return text.split(/\r?\n/).map((line, index) => {
    const key = `${index}-${line.slice(0, 12)}`;
    if (line.startsWith("# ")) {
      return (
        <div key={key} style={{ color: theme.gold, fontSize: 15, fontWeight: 800, marginBottom: 8 }}>
          {line.slice(2)}
        </div>
      );
    }
    if (line.startsWith("## ")) {
      return (
        <div
          key={key}
          style={{ color: theme.jade, fontSize: 12, fontWeight: 700, margin: "10px 0 4px" }}
        >
          {line.slice(3)}
        </div>
      );
    }
    if (line.startsWith("- ")) {
      return (
        <div key={key} style={{ fontSize: 11, color: theme.muted, marginLeft: 10 }}>
          • {line.slice(2)}
        </div>
      );
    }
    if (line.trim().length === 0) {
      return <div key={key} style={{ height: 4 }} />;
    }
    return (
      <div key={key} style={{ fontSize: 11, color: theme.text, marginBottom: 3 }}>
        {line}
      </div>
    );
  });
}

export function CreditsWindow() {
  const open = useUiStore((state) => state.creditsOpen);
  const setOpen = useUiStore((state) => state.setCreditsOpen);
  const [text, setText] = useState(FALLBACK);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    fetch("/assets/CREDITS.md")
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((body) => {
        if (!cancelled) {
          setText(body);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setText(FALLBACK);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const store = useUiStore.getState();
      if (event.key === "Escape" && store.creditsOpen) {
        store.setCreditsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return null;
  }

  return (
    <Window id="credits" title="Credits" width={380} onClose={() => setOpen(false)}>
      <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
        {renderLines(text)}
      </div>
    </Window>
  );
}
