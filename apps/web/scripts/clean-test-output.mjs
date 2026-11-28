import { rm } from 'node:fs/promises';

// Fixed path relative to this script: never accept a caller-provided directory.
await rm(new URL('../.test-dist/', import.meta.url), {
  recursive: true,
  force: true,
});
