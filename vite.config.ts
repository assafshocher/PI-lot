import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  plugins: [react(), cloudflare({ viteEnvironment: { name: "worker" }, inspectorPort: false })],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
