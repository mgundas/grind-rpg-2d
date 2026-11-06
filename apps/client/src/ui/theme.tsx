import type { CSSProperties, ReactNode } from "react";

/**
 * Dark lacquered-wood + jade + gold theme (GAME_DESIGN.md §2). Inline styles
 * keep the client dependency-free (Tailwind lives only in the admin app).
 */
export const theme = {
  bg: "rgba(16, 20, 19, 0.96)",
  panelBorder: "1px solid rgba(201, 162, 39, 0.7)",
  jade: "#5da88f",
  jadeDark: "#3a4a44",
  gold: "#c9a227",
  text: "#cfd8d3",
  textStrong: "#e8eeea",
  muted: "#7d8a84",
  danger: "#ff7a6e",
} as const;

export const styles = {
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "7px 9px",
    borderRadius: 5,
    border: "1px solid rgba(93, 168, 143, 0.45)",
    background: "#0e1311",
    color: theme.textStrong,
    fontSize: 13,
    outline: "none",
  } satisfies CSSProperties,
  label: {
    display: "block",
    fontSize: 12,
    marginBottom: 4,
    color: theme.text,
  } satisfies CSSProperties,
  hint: { fontSize: 10, color: theme.muted, marginTop: 3 } satisfies CSSProperties,
  error: { margin: "8px 0 0", fontSize: 11, color: theme.danger } satisfies CSSProperties,
  button: {
    padding: "9px 14px",
    borderRadius: 6,
    border: "none",
    background: theme.jade,
    color: "#0f1210",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  } satisfies CSSProperties,
  ghostButton: {
    padding: "6px 10px",
    borderRadius: 5,
    border: `1px solid ${theme.jade}`,
    background: "transparent",
    color: theme.text,
    fontSize: 12,
    cursor: "pointer",
  } satisfies CSSProperties,
};

export function Panel({
  title,
  subtitle,
  children,
  width = 380,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: number;
}) {
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
      <div
        style={{
          width,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          padding: 24,
          borderRadius: 10,
          border: theme.panelBorder,
          background: theme.bg,
          boxShadow: "0 12px 40px rgba(0,0,0,0.65)",
          pointerEvents: "auto",
          color: theme.text,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            color: theme.jade,
            textAlign: "center",
            letterSpacing: 1,
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            style={{
              margin: "4px 0 18px",
              fontSize: 11,
              letterSpacing: 2,
              color: theme.muted,
              textAlign: "center",
              textTransform: "uppercase",
            }}
          >
            {subtitle}
          </p>
        ) : (
          <div style={{ height: 14 }} />
        )}
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={htmlFor} style={styles.label}>
        {label}
      </label>
      {children}
      {hint ? <div style={styles.hint}>{hint}</div> : null}
    </div>
  );
}
