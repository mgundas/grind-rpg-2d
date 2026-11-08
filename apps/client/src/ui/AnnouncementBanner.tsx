import { useEffect } from "react";
import { useUiStore } from "./store";
import { theme } from "./theme";

const KIND_COLOR = {
  admin: "#5da88f",
  scheduled: "#c9a227",
  shutdown: "#ff8f84",
  upgrade: "#e0b64a",
} as const;

/** Top-centre server-wide banner; auto-dismisses after a short display. */
export function AnnouncementBanner() {
  const announcement = useUiStore((state) => state.announcement);
  const setAnnouncement = useUiStore((state) => state.setAnnouncement);

  useEffect(() => {
    if (!announcement) {
      return;
    }
    const timer = setTimeout(() => setAnnouncement(null), 9000);
    return () => clearTimeout(timer);
  }, [announcement, setAnnouncement]);

  if (!announcement) {
    return null;
  }
  const color = KIND_COLOR[announcement.kind] ?? KIND_COLOR.admin;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 56,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "min(620px, calc(100vw - 32px))",
        padding: "9px 16px",
        borderRadius: 7,
        border: `1px solid ${color}`,
        background: "rgba(12, 16, 15, 0.94)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.55)",
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        textAlign: "center",
        zIndex: 60,
        pointerEvents: "auto",
      }}
    >
      {announcement.message}
      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={() => setAnnouncement(null)}
        style={{
          marginLeft: 10,
          border: "none",
          background: "transparent",
          color: theme.muted,
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        ×
      </button>
    </div>
  );
}
