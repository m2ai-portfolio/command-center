#!/usr/bin/env node
/**
 * Smoke test for the Sky-Lynx event bridge.
 *
 * Imports the compiled bridge from dist/ and emits one of each event type
 * (mission_start, mission_complete, mission_fail) with a correlation id
 * whose prefix makes the files easy to grep for after the run.
 *
 * Run from the command-center project root AFTER `npm run build`:
 *
 *   node scripts/smoke-skylynx-bridge.mjs
 *
 * The script prints the resolved events directory, the three new file paths,
 * and the parsed JSON of one file for quick eyeballing.
 *
 * Cleanup: the emitted files are intentionally left on disk — Sky-Lynx will
 * consume them on its next pass. If you want to remove them manually, grep
 * the events dir for the correlation-id prefix emitted below.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Import the compiled bridge. `npm run build` emits to dist/server/<source-layout>,
// so the bridge lives at dist/server/server/skylynx-event-bridge.js.
import { emitSkyLynxEvent } from '../dist/server/server/skylynx-event-bridge.js';

function eventsDir() {
  const fromEnv = process.env.SKYLYNX_EVENTS_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), '.local', 'share', 'skylynx-events');
}

async function latestFile(dir, count) {
  const { readdir, stat } = await import('node:fs/promises');
  const entries = await readdir(dir);
  const jsonFiles = entries.filter(n => n.endsWith('.json') && !n.startsWith('.'));
  const withMtime = await Promise.all(
    jsonFiles.map(async name => {
      const s = await stat(join(dir, name));
      return { name, mtimeMs: s.mtimeMs };
    }),
  );
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withMtime.slice(0, count).map(e => e.name);
}

async function main() {
  const dir = eventsDir();
  const stamp = Date.now();
  const correlationId = `smoke-${stamp}`;

  console.log(`[smoke] events dir:       ${dir}`);
  console.log(`[smoke] correlation_id:   ${correlationId}`);
  console.log(`[smoke] emitting 3 events (start / complete / fail)…`);

  await emitSkyLynxEvent('mission_start', correlationId, {
    agent_id: 'smoke-agent',
    note: 'smoke test — mission_start',
  });
  await emitSkyLynxEvent('mission_complete', correlationId, {
    agent_id: 'smoke-agent',
    duration_ms: 1234,
    note: 'smoke test — mission_complete',
  });
  await emitSkyLynxEvent('mission_fail', correlationId, {
    agent_id: 'smoke-agent',
    error: 'smoke test — synthetic failure',
    phase: 'smoke',
  });

  // Read back the three newest event files.
  const latest = await latestFile(dir, 3);
  console.log(`[smoke] 3 most recent files in ${dir}:`);
  for (const name of latest) {
    console.log(`  - ${join(dir, name)}`);
  }

  // Print the parsed JSON of the newest file so the caller can eyeball the schema.
  if (latest[0]) {
    const sample = JSON.parse(await readFile(join(dir, latest[0]), 'utf8'));
    console.log(`[smoke] sample parsed JSON (${latest[0]}):`);
    console.log(JSON.stringify(sample, null, 2));
  }
}

main().catch(err => {
  console.error('[smoke] failed:', err);
  process.exit(1);
});
