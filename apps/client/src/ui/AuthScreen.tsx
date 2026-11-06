import { useState, type FormEvent } from "react";
import { GAME_NAME, KINGDOMS, isValidCharacterName, type KingdomId } from "@jadethrone/shared";
import { ApiError, api } from "../network/api";
import { useUiStore } from "./store";
import { Field, Panel, styles, theme } from "./theme";

type Mode = "login" | "register";

/** Login and registration (GAME_DESIGN.md §12 Phase 2). */
export function AuthScreen() {
  const setAuthenticated = useUiStore((state) => state.setAuthenticated);
  const authError = useUiStore((state) => state.authError);
  const setAuthError = useUiStore((state) => state.setAuthError);
  const [mode, setMode] = useState<Mode>("login");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [kingdom, setKingdom] = useState<KingdomId>("ember");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !busy &&
    password.length > 0 &&
    (mode === "login"
      ? login.trim().length > 0
      : email.includes("@") && isValidCharacterName(username.trim()) && password.length >= 8);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    setError(null);
    setAuthError(null);
    try {
      const result =
        mode === "login"
          ? await api.login({ login: login.trim(), password })
          : await api.register({
              email: email.trim(),
              username: username.trim(),
              password,
              kingdom,
            });
      setAuthenticated(result.account, result.characters);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setAuthError(null);
  };

  return (
    <Panel
      title={GAME_NAME}
      subtitle={mode === "login" ? "Sign in to your account" : "Create an account"}
    >
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["login", "register"] as const).map((candidate) => {
          const active = mode === candidate;
          return (
            <button
              key={candidate}
              type="button"
              onClick={() => switchMode(candidate)}
              style={{
                flex: 1,
                padding: "7px 0",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: active ? 700 : 400,
                color: active ? "#0f1210" : theme.text,
                background: active ? theme.jade : "transparent",
                border: `1px solid ${theme.jade}`,
              }}
            >
              {candidate === "login" ? "Sign in" : "Register"}
            </button>
          );
        })}
      </div>

      <form onSubmit={submit}>
        {mode === "login" ? (
          <Field label="Email or username" htmlFor="auth-login">
            <input
              id="auth-login"
              autoComplete="username"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              style={styles.input}
            />
          </Field>
        ) : (
          <>
            <Field label="Email" htmlFor="auth-email">
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                style={styles.input}
              />
            </Field>
            <Field label="Username" htmlFor="auth-username" hint="3–16 letters or numbers.">
              <input
                id="auth-username"
                autoComplete="username"
                maxLength={16}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                style={styles.input}
              />
            </Field>
          </>
        )}

        <Field
          label="Password"
          htmlFor="auth-password"
          hint={mode === "register" ? "At least 8 characters." : undefined}
        >
          <input
            id="auth-password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={styles.input}
          />
        </Field>

        {mode === "register" ? (
          <>
            <div style={styles.label}>Kingdom</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {KINGDOMS.map((candidate) => {
                const active = candidate.id === kingdom;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setKingdom(candidate.id as KingdomId)}
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
          </>
        ) : null}

        <button type="submit" disabled={!canSubmit} style={{ ...styles.button, width: "100%" }}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        {error || authError ? <p style={styles.error}>{error ?? authError}</p> : null}
      </form>
    </Panel>
  );
}
