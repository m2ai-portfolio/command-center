/**
 * 028 Phase 2: WIP-snapshot suppression lock for in-flight mission-task dispatches.
 *
 * The WIP-snapshot cron at ~/bin/git-wip-snapshot.sh scans every repo under
 * ~/projects/ every 30 min and commits any dirty tree. Its two existing gates
 * (explicit lock file + live `claude` cwd-in-repo check) miss CMD mission-task
 * dispatches because those run with cwd=/tmp/cmd-mt-* (a worktree), not the
 * source repo. A stray Edit/Write to an absolute source-repo path (see 027
 * Phase 1.5) would then race the cron.
 *
 * This module manages a per-repo lock directory `<repo>/.cmd-agent-active/`
 * containing one sentinel per active dispatch. Directory form allows multiple
 * concurrent dispatches against the same source repo without one completing
 * task clobbering another's lock.
 */
import fs from 'fs';
import path from 'path';

const LOCK_DIR_NAME = '.cmd-agent-active';

function lockDirFor(repoPath: string): string {
  return path.join(repoPath, LOCK_DIR_NAME);
}

function sentinelFor(repoPath: string, taskId: string): string {
  return path.join(lockDirFor(repoPath), taskId);
}

/**
 * Touch a per-task sentinel so the WIP cron suppresses snapshots while this
 * dispatch is live. Best-effort: logs but does not throw so a filesystem
 * hiccup cannot fail the dispatch path.
 */
export function touchAgentLock(repoPath: string, taskId: string): void {
  try {
    fs.mkdirSync(lockDirFor(repoPath), { recursive: true });
    fs.writeFileSync(sentinelFor(repoPath, taskId), String(Date.now()));
  } catch (err) {
    console.error(`[agent-lock] touch failed for ${repoPath}:${taskId}:`, err);
  }
}

/**
 * Release a per-task sentinel on terminal state. Idempotent: missing sentinel
 * is not an error. The lock directory itself is left in place even when empty
 * so the cron's -e check is stable; it's cheap and reused on the next dispatch.
 */
export function releaseAgentLock(repoPath: string, taskId: string): void {
  try {
    fs.unlinkSync(sentinelFor(repoPath, taskId));
  } catch {
    // Already gone or never created
  }
}

/**
 * Startup reconciliation: remove sentinels whose task id is not in the live
 * set. Called once from startMissionDispatcher so a crash mid-dispatch does
 * not leave a stale lock that starves the WIP cron forever.
 */
export function reconcileStaleLocks(repoPath: string, liveTaskIds: Set<string>): void {
  const dir = lockDirFor(repoPath);
  if (!fs.existsSync(dir)) return;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (liveTaskIds.has(entry)) continue;
      try { fs.unlinkSync(path.join(dir, entry)); } catch { /* ignore */ }
    }
  } catch (err) {
    console.error(`[agent-lock] reconcile failed for ${repoPath}:`, err);
  }
}
