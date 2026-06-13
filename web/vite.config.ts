import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Pin the page origin so same-origin API/WS resolution (lib/config.ts) and
    // the MSW handlers registered against http://127.0.0.1:4517 agree in tests.
    environmentOptions: { jsdom: { url: 'http://127.0.0.1:4517' } },
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/**/*.d.ts',
        // shadcn-generated primitives are vendored: we own the files but do not
        // author them line-by-line, so coverage is measured on the app logic
        // that consumes them, not on the generated Radix wrappers themselves.
        'src/components/ui/**',
        'src/hooks/use-mobile.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
