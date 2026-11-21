import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";

// Relative base so the build works from any GitHub Pages sub-path (/metalflix/…)
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    /**
     * Smart TV browsers are years behind: either they ignore ES modules
     * outright, or they choke on one syntax they do not know and leave a blank
     * page. The legacy build ships an ES5 bundle with its own polyfills plus a
     * nomodule loader, so those devices get a working app instead of a corpse.
     */
    legacy({
      targets: ["chrome >= 49", "safari >= 10", "firefox >= 52", "edge >= 15"],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
  ],
  build: {
    outDir: "dist",
    // Smart TV browsers lag years behind desktop Chrome: transpile the syntax
    // they choke on (optional chaining, ??, class fields) instead of shipping
    // ES2020 and letting the whole bundle die before React mounts.
    target: "es2015",
  },
});
