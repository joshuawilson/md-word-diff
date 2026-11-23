import { defineConfig } from 'vitest/config';
// fileParallelism off: the <1s performance tests must not compete for CPU with other test files.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 20000, fileParallelism: false } });
