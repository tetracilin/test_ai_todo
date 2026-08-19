import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    environmentOptions: {},
    env: { NODE_ENV: 'development' },
    setupFiles: ['test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/discord-bridge/**',
      'integration/**',
      'e2e/**',
    ],
  },
});
