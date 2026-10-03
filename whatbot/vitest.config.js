import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js'],
    // Config validates env at import time and exits on failure. Tests need
    // syntactically valid placeholders; none of these reach a real service.
    env: {
      NODE_ENV: 'test',
      REDIS_URL: 'redis://localhost:6379',
      WHATSAPP_NUMBERS: 'test:+14155238886',
      WHATSAPP_AUTH_DIR: '.auth-test',
      OPENAI_API_KEY: 'sk-test',
      DATA_SOURCE: 'fake',
    },
  },
});
