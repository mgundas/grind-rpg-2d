import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/admin/" : "/",
  plugins: [react(), tailwindcss()],
  envDir: "../..",
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:2567",
        changeOrigin: true,
      },
      "/colyseus": {
        target: "http://127.0.0.1:2567",
        changeOrigin: true,
        ws: true,
      },
    },
  },
}));
