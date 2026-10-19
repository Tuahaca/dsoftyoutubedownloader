import { defineConfig } from 'vitest/config';

// Hits YouTube through real yt-dlp. Needs YTDL_TEST_URL (a Creative Commons video) and a built host.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
  },
});
