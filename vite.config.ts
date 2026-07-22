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
    stylex.vite({
      // Keep application layout CSS in the always-loaded shell. The default
      // "first CSS asset" can be MapLibre's lazy chunk, leaving the controls
      // unstyled until a passenger explicitly opens the map.
      cssInjectionTarget: (fileName) => /(^|\/)styles-[^/]+\.css$/.test(fileName),
    }),
    tanstackStart({ spa: { enabled: true } }),
    solidPlugin({ ssr: true }),
  ],
});
