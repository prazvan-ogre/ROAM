import { defineConfig } from "vitest/config";
import path from "node:path";

// Regression-test harness added to verify specific hypotheses from the
// 2026-09-05 architecture/security review (see CHANGELOG). Deliberately
// separate from `next build`'s own toolchain -- these tests import route
// handlers and lib functions directly, with the Supabase client mocked at
// the module boundary, never against a real database or the app's own
// dev server.
//
// JSX is transformed by esbuild directly (jsx: "automatic") rather than
// via @vitejs/plugin-react: that package resolves its own copy of vite,
// whose types collide with the one vitest bundles internally and break
// `tsc --noEmit` on this file -- esbuild's built-in transform needs no
// separate vite plugin and sidesteps the duplicate-types problem entirely.
export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
