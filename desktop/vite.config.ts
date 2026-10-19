import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    headers: { "Permissions-Policy": "serial=(self)" },
  },
  preview: { headers: { "Permissions-Policy": "serial=(self)" } },
  build: { target: "es2022" },
});
