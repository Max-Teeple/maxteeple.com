import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative asset URLs so the built demo works at /projects/clubsense/demo/.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../public/projects/clubsense/demo",
    emptyOutDir: true,
    sourcemap: false,
  },
});
