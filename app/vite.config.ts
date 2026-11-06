import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app calls the Tender API at /api; in development Vite forwards those calls to the API server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.TENDER_API_URL ?? "http://localhost:8787" },
  },
});
