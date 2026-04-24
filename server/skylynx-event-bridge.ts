/**
 * Sky-Lynx event bridge (CMD side).
 *
 * Sibling sink to the in-process `triggerBus`: tees CMD mission lifecycle
 * events (`mission_start`, `mission_complete`, `mission_fail`) into the shared
 * `~/.local/share/skylynx-events/` directory, where Sky-Lynx's pattern
 * aggregator consumes them alongside Metroplex's events.
 *
 * Schema matches `projects/metroplex/event_emitter.py`:
 *   {
 *     event_type:      "mission_start" | "mission_complete" | "mission_fail",
 *     source_repo:     "command-center",
 *     correlation_id:  <mission_task_id>,
 *     timestamp:       ISO 8601 UTC,
 *     source:          "command-center",  // deprecated alias, kept for back-compat
 *     details:         { ...lifecycle-specific fields... }
 *   }
 *
 * Atomic write: write `.{filename}.tmp`, then `rename` to `{filename}`.
 * Filename is `{hrTimeNs}.json` — strictly monotonic across a single process,
 * collision-free across processes (nanosecond granularity).
 *
 * Failures are swallowed with a `console.warn` — the mission lifecycle must
 * never be blocked or crashed by a disk / directory issue on this sink.
 */

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type SkyLynxEventType = 'mission_start' | 'mission_complete' | 'mission_fail';

const SOURCE_REPO = 'command-center';

function eventsDir(): string {
  const fromEnv = process.env.SKYLYNX_EVENTS_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), '.local', 'share', 'skylynx-events');
}

/**
 * Return a nanosecond-precision timestamp usable as a filename stem. Uses
 * `process.hrtime.bigint()` for a monotonic counter within a process, but
 * rebases onto wall-clock `Date.now() * 1_000_000` so ordering is comparable
 * to Metroplex's `time.time_ns()` output.
 *
 * Without the rebase, Metroplex events and CMD events would not sort into a
 * single timeline. Sky-Lynx orders by filename, so this matters.
 */
function filenameNs(): string {
  // Wall-clock ms -> ns, plus an hrtime-derived sub-ms tail for ordering.
  const wallNs = BigInt(Date.now()) * 1_000_000n;
  const tailNs = process.hrtime.bigint() % 1_000_000n; // 0..999_999
  return (wallNs + tailNs).toString();
}

/**
 * Emit a Sky-Lynx event for a CMD mission lifecycle transition.
 *
 * Fire-and-forget: await it if you're in an async path, or `.catch(() => {})`
 * it if you can't — the internal error handler already logs and swallows.
 *
 * @param eventType     lifecycle transition name
 * @param correlationId mission_task_id — ties events for the same task
 * @param details       lifecycle-specific payload (agent_id, error, duration_ms, ...)
 */
export async function emitSkyLynxEvent(
  eventType: SkyLynxEventType,
  correlationId: string,
  details: Record<string, unknown>,
): Promise<void> {
  const dir = eventsDir();
  const stem = filenameNs();
  const finalName = `${stem}.json`;
  const tmpName = `.${finalName}.tmp`;
  const tmpPath = join(dir, tmpName);
  const finalPath = join(dir, finalName);

  const event = {
    event_type: eventType,
    source_repo: SOURCE_REPO,
    correlation_id: correlationId,
    timestamp: new Date().toISOString(),
    source: SOURCE_REPO, // deprecated alias, kept for back-compat with older consumers
    details,
  };

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmpPath, JSON.stringify(event), { encoding: 'utf8' });
    await rename(tmpPath, finalPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[skylynx-event-bridge] failed to emit ${eventType} for ${correlationId}: ${msg}`);
    // Best-effort cleanup of the temp file. Swallow all errors — the mission
    // lifecycle MUST NOT be blocked or crashed by this sink.
    try {
      await unlink(tmpPath);
    } catch {
      /* ignore */
    }
  }
}
