import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: path.resolve(__dirname, "../assets"),
  define: {
    'process.env.VITE_DEV_BUILD': JSON.stringify(process.env.VITE_DEV_BUILD || 'false'),
  },
  server: {
    // Same-origin API in development, matching production where the backend serves the
    // frontend. changeOrigin stays off so the backend's Origin check (#144) sees matching
    // Origin and Host headers.
    proxy: {
      "/api": process.env.VITE_API_PROXY || "http://localhost:8000",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
