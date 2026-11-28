import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('test cleanup removes only its fixed output directory regardless of caller cwd and is repeatable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-test-cleanup-'));
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, '.test-dist', 'tests'), { recursive: true });
    await mkdir(join(root, 'dist'));
    const script = join(root, 'scripts', 'clean-test-output.mjs');
    await copyFile(
      new URL('../../scripts/clean-test-output.mjs', import.meta.url),
      script,
    );
    await writeFile(
      join(root, '.test-dist', 'tests', 'deleted-source.test.js'),
      'stale test',
    );
    const keep = join(root, 'dist', 'keep.js');
    await writeFile(keep, 'unrelated build output');
    // Running from dist must not remove dist or create/remove dist/.test-dist.
    const callerOutput = join(root, 'dist', '.test-dist');
    await mkdir(callerOutput);
    await writeFile(join(callerOutput, 'keep.txt'), 'unrelated directory');
    for (let run = 0; run < 2; run++) {
      const result = spawnSync(process.execPath, [script], {
        cwd: join(root, 'dist'),
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      await assert.rejects(stat(join(root, '.test-dist')), { code: 'ENOENT' });
      assert.equal(await readFile(keep, 'utf8'), 'unrelated build output');
      assert.equal(
        await readFile(join(callerOutput, 'keep.txt'), 'utf8'),
        'unrelated directory',
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
