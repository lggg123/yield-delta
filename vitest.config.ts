import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load environment variables before defining config
config({ path: '.env' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/tests/setup.ts'],
    // Make sure environment variables are available in tests
    env: {
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'], // 'text' shows summary in terminal
    },
  },
  define: {
    // Ensure process.env is available
    'process.env': 'process.env',
  },
});