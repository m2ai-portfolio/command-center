import { spawn } from 'child_process';
import { updateTask, addTaskLog } from './task-store.js';

/**
 * Execute a task via Claude Code CLI with the agent's system prompt.
 * Updates the task store with progress and results.
 */
export async function executeTask(
  taskId: string,
  goal: string,
  systemPrompt: string,
  context?: string,
  timeoutMs = 600_000,
): Promise<void> {
  updateTask(taskId, { state: 'running' });
  addTaskLog(taskId, 'info', 'Starting Claude Code session...');

  const startTime = Date.now();

  // Build the full prompt with system prompt + context + goal
  const parts: string[] = [];
  parts.push(`[Agent Instructions]\n${systemPrompt}\n[End Agent Instructions]`);
  if (context) {
    parts.push(`[Context]\n${context}\n[End Context]`);
  }
  parts.push(goal);
  const fullPrompt = parts.join('\n\n');

  try {
    const result = await runClaudeCode(fullPrompt, timeoutMs);
    const durationMs = Date.now() - startTime;

    updateTask(taskId, {
      state: 'completed',
      result,
      duration_ms: durationMs,
    });
    addTaskLog(taskId, 'info', `Completed in ${Math.round(durationMs / 1000)}s`);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);

    updateTask(taskId, {
      state: 'failed',
      error: errMsg,
      duration_ms: durationMs,
    });
    addTaskLog(taskId, 'error', `Failed: ${errMsg}`);
  }
}

function runClaudeCode(prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['--print', prompt, '--output-format', 'text'];

    // Build env without ANTHROPIC_API_KEY (use Max OAuth)
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const child = spawn('claude', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim() || '(no output)');
      } else {
        reject(new Error(`Claude Code exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
    });
  });
}
