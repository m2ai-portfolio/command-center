import type { A2ATaskState, A2ATaskLog } from '../../shared/a2a.js';

interface TaskRecord {
  id: string;
  goal: string;
  context?: string;
  sender_id: string;
  sender_name: string;
  state: A2ATaskState;
  result?: string;
  error?: string;
  duration_ms?: number;
  logs: A2ATaskLog[];
  created_at: number;
}

/** In-memory task store. Sufficient for single-agent process. */
const tasks = new Map<string, TaskRecord>();

export function createTask(
  id: string,
  goal: string,
  senderId: string,
  senderName: string,
  context?: string,
): TaskRecord {
  const record: TaskRecord = {
    id,
    goal,
    context,
    sender_id: senderId,
    sender_name: senderName,
    state: 'queued',
    logs: [],
    created_at: Date.now(),
  };
  tasks.set(id, record);
  return record;
}

export function getTask(id: string): TaskRecord | undefined {
  return tasks.get(id);
}

export function updateTask(id: string, updates: Partial<TaskRecord>): void {
  const task = tasks.get(id);
  if (!task) return;
  Object.assign(task, updates);
}

export function addTaskLog(id: string, level: A2ATaskLog['level'], message: string): void {
  const task = tasks.get(id);
  if (!task) return;
  task.logs.push({ timestamp: Date.now(), level, message });
}

export function listTasks(): TaskRecord[] {
  return Array.from(tasks.values()).sort((a, b) => b.created_at - a.created_at);
}
