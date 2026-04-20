import { insertHivemindEvent, type HivemindEventInput } from './db.js';

/**
 * HiveMind (R3.b / 030) — cross-agent, cross-mission activity log.
 *
 * A single `emit()` helper used throughout the orchestrator, worker-manager,
 * and mission-task paths to record structured lifecycle events. Reads happen
 * via listHivemindEvents() + the /api/hivemind endpoint.
 *
 * Emit is fire-and-forget from callers' POV: errors are logged and swallowed
 * so a storage hiccup never breaks a mission.
 */

export type HivemindEventType =
  | 'mission_start'
  | 'mission_end'
  | 'agent_dispatch'
  | 'agent_complete'
  | 'agent_fail'
  | 'judge_verdict'
  | 'reasoner_action'
  | 'subtask_start'
  | 'subtask_complete'
  | 'mission_task_dispatch'
  | 'mission_task_complete';

export function emitHivemind(
  event: Omit<HivemindEventInput, 'event_type'> & { event_type: HivemindEventType },
): void {
  try {
    insertHivemindEvent(event);
  } catch (err) {
    console.error('[hivemind] emit failed:', err, event);
  }
}
