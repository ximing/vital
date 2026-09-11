import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pool } from '../../src/db/index.js';
import { applyMigrations } from '../../src/db/migrator.js';
import {
  BASELINE_PATH,
  LATEST_PATH,
  SNAPSHOT_DIR,
  buildSnapshot,
  diffSnapshots,
} from './core.js';

/**
 * Fixed-case eval runner (offline — writes only to the test database).
 *
 *   pnpm eval:agent               reseed fixture → write __snapshots__/latest.json
 *   pnpm eval:agent --check       compare a fresh run against baseline.json, exit 1 on drift
 *   pnpm eval:agent --update      regenerate baseline.json after an intentional change
 *   pnpm eval:agent --check --tamper   demo: tamper one feedback, watch --check fail
 */
async function main(): Promise<number> {
  await applyMigrations();
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const update = args.includes('--update');
  const tamper = args.includes('--tamper');
  if (check && update) {
    console.error('--update would mask --check; pick one');
    return 1;
  }

  const snapshot = await buildSnapshot({ tamper });
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(LATEST_PATH, json);
  console.log(`latest snapshot written: ${LATEST_PATH}`);

  if (update || !existsSync(BASELINE_PATH)) {
    await writeFile(BASELINE_PATH, json);
    console.log(`baseline snapshot written: ${BASELINE_PATH}`);
  }
  if (!check) return 0;

  let baselineRaw: string;
  try {
    baselineRaw = await readFile(BASELINE_PATH, 'utf8');
  } catch {
    console.error(`baseline snapshot missing: ${BASELINE_PATH} — run with --update first`);
    return 1;
  }
  const diff = diffSnapshots(JSON.parse(baselineRaw), snapshot);
  if (diff.length > 0) {
    console.error('agent eval snapshot drifted from baseline:');
    for (const line of diff) console.error(`  ${line}`);
    return 1;
  }
  console.log('agent eval snapshot matches baseline');
  return 0;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error('agent eval runner failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
