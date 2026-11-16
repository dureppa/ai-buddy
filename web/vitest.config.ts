import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep Node's Web Storage from shadowing storage provided by jsdom.
    execArgv: ['--no-experimental-webstorage'],
  },
});
