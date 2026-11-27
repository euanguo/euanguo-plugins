import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.BB_ANTIGRAVITY_TASK_STATE_DIR) {
  const dir = mkdtempSync(join(tmpdir(), 'ag-test-state-'));
  process.env.BB_ANTIGRAVITY_TASK_STATE_DIR = dir;
  process.on('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Best-effort cleanup of isolated test directory.
    }
  });
}
