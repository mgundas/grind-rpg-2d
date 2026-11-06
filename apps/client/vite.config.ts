import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// serverPort mirrors DEFAULT_SERVER_PORT in @jadethrone/shared — the Vite
// config cannot import that TS-source package (it externalizes deps), so
// the literal is intentional. Keep both in sync when the server port moves.
export default defineConfig(({ mode }) => {
  // Root .env (repo root = ../../) is the single env source; VITE_* vars and
  // bootstrap settings (e.g. SERVER_PORT for the /api proxy) come from there.
  const env = loadEnv(mode, "../..", "");
  const serverPort = Number(env.GAME_SERVER_PORT ?? 2567);

  return {
    plugins: [react()],
    envDir: "../..",
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": `http://localhost:${serverPort}`,
      },
    },
  };
});
