import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackRouter } from "@tanstack/router-plugin/vite";

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const standardJsonEsm = fileURLToPath(
  new URL(
    './node_modules/@standard-community/standard-json/dist/index.js',
    import.meta.url,
  ),
)

const config = defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      // Rolldown/Vite 8 can't parse `.cjs` files that contain dynamic
      // `await import(...)`. Force this dep to its ESM entry so the
      // `require` condition from @tambo-ai/client never pulls the CJS
      // shards through the production client build.
      {
        find: /^@standard-community\/standard-json$/,
        replacement: standardJsonEsm,
      },
    ],
  },
  plugins: [ tanstackRouter({ target: "react" }),devtools(), tailwindcss(), viteReact()],
})

export default config
