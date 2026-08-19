import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/discord-bridge/**'],
  },
});
