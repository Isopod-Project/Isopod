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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
