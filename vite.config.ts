import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  plugins: [
    {
      name: "remove-ssr-external",
      configResolved(config) {
        if (config.environments.ssr) {
          config.environments.ssr.resolve.external = [];
        }
      },
    },
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    stylex.vite(),
    tanstackStart({ spa: { enabled: true } }),
    solidPlugin({ ssr: true }),
  ],
});
