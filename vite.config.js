import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // dev: forward API calls to the Flask server
    proxy: {
      "/frame":   "http://localhost:5174",
      "/info":    "http://localhost:5174",
      "/predict": "http://localhost:5174",
      "/upload":  "http://localhost:5174",
    },
  },
});
