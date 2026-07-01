import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'log-parser/test/**/*.test.ts',
      'companion/test/**/*.test.ts',
    ],
    environment: 'node',
  },
});
