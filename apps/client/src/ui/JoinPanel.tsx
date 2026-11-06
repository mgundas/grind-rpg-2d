import { useState, type FormEvent } from "react";
import { GAME_NAME, KINGDOMS } from "@jadethrone/shared";
import { connect } from "../network/session";
import { useUiStore } from "./store";

function defaultName(): string {
  return `Guest${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Phase-1 guest join (real accounts arrive in Phase 2). The panel is hidden
 * once connected; `#overlay` is pointer-transparent, so this card opts back in.
 */
export function JoinPanel() {
  const phase = useUiStore((state) => state.connectionPhase);
  const connectionError = useUiStore((state) => state.connectionError);
  const [name, setName] = useState(defaultName);
  const [kingdom, setKingdom] = useState(KINGDOMS[0]?.id ?? "ember");
  const [submitting, setSubmitting] = useState(false);

  if (phase === "connected") {
    return null;
  }

  const trimmed = name.trim();
  const valid = trimmed.length >= 3 && trimmed.length <= 16;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || submitting) {
      return;
    }
    setSubmitting(true);
    void connect({ name: trimmed, kingdom }).finally(() => setSubmitting(false));
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 300,
          padding: 24,
          borderRadius: 10,
          border: "1px solid rgba(201, 162, 39, 0.75)",
          background: "rgba(16, 20, 19, 0.94)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.65)",
          pointerEvents: "auto",
          color: "#cfd8d3",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18, color: "#5da88f", textAlign: "center" }}>
          {GAME_NAME}
        </h1>
        <p
          style={{
            margin: "4px 0 18px",
            fontSize: 11,
            letterSpacing: 2,
            color: "#7d8a84",
            textAlign: "center",
            textTransform: "uppercase",
          }}
        >
          Enter the village
        </p>

        <label htmlFor="guest-name" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
          Name
        </label>
        <input
          id="guest-name"
          value={name}
          maxLength={16}
          onChange={(event) => setName(event.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "7px 9px",
            borderRadius: 5,
            border: "1px solid rgba(93, 168, 143, 0.45)",
            background: "#0e1311",
            color: "#e8eeea",
            fontSize: 13,
            outline: "none",
          }}
        />

        <div style={{ margin: "14px 0 6px", fontSize: 13 }}>Kingdom</div>
        <div style={{ display: "flex", gap: 6 }}>
          {KINGDOMS.map((candidate) => {
            const active = candidate.id === kingdom;
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setKingdom(candidate.id)}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: 5,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: active ? 700 : 400,
                  color: active ? "#0f1210" : candidate.color,
                  background: active ? candidate.color : "transparent",
                  border: `1px solid ${candidate.color}`,
                }}
              >
                {candidate.label}
              </button>
            );
          })}
        </div>

        <button
          type="submit"
          disabled={!valid || submitting}
          style={{
            marginTop: 18,
            width: "100%",
            padding: "9px 0",
            borderRadius: 6,
            border: "none",
            cursor: valid && !submitting ? "pointer" : "default",
            background: valid ? "#5da88f" : "#3a4a44",
            color: "#0f1210",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {submitting || phase === "connecting" ? "Connecting…" : "Play"}
        </button>

        {connectionError ? (
          <p style={{ margin: "10px 0 0", fontSize: 11, color: "#ff7a6e" }}>{connectionError}</p>
        ) : (
          <p style={{ margin: "10px 0 0", fontSize: 11, color: "#68756f", textAlign: "center" }}>
            Temporary guest name — accounts arrive in Phase 2.
          </p>
        )}
      </form>
    </div>
  );
}
