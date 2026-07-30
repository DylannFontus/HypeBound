/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: true // allow LAN access for mobile-device testing
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node"
  }
});
