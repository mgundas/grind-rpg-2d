import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Same env source as the game client: the root .env owns GAME_SERVER_PORT.
  const env = loadEnv(mode, "../..", "");
  const serverPort = Number(env.GAME_SERVER_PORT ?? 2567);
  const target = `http://127.0.0.1:${serverPort}`;

  return {
    base: mode === "production" ? "/admin/" : "/",
    plugins: [react(), tailwindcss()],
    envDir: "../..",
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
        },
        "/colyseus": {
          target,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
