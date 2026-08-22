import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local dev: `vercel dev` serves both the Vite frontend and the Python
// /api functions together on one port, so this proxy is only a fallback
// for `npm run dev` (Vite alone) pointed at `vercel dev`'s API port.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
