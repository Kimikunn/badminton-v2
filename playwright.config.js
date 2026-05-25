import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:8089',
    screenshot: 'on',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'light',
      use: {
        colorScheme: 'light',
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'dark',
      use: {
        colorScheme: 'dark',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
})
