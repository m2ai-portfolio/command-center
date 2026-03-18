import { spawn } from 'child_process';
import { updateTask, addTaskLog } from './task-store.js';

/**
 * Execute a task via Claude Code CLI with the agent's system prompt.
 * Uses --append-system-prompt for agent instructions (separate from user goal).
 * Uses --allowedTools to prevent interactive permission prompts in headless mode.
 */
export async function executeTask(
  taskId: string,
  goal: string,
  systemPrompt: string,
  context?: string,
  timeoutMs = 900_000,
): Promise<void> {
  updateTask(taskId, { state: 'running' });
  addTaskLog(taskId, 'info', 'Starting Claude Code session...');

  const startTime = Date.now();

  // Build user prompt with optional context
  const userPrompt = context
    ? `[Context]\n${context}\n[End Context]\n\n${goal}`
    : goal;

  try {
    const result = await runClaudeCode(userPrompt, systemPrompt, timeoutMs);
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

function runClaudeCode(prompt: string, systemPrompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--print', prompt,
      '--output-format', 'text',
      '--append-system-prompt', systemPrompt,
      '--allowedTools', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash',
      '--max-turns', '25',
    ];

    // Build env without ANTHROPIC_API_KEY (use Max OAuth)
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const child = spawn('claude', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // Log stderr lines as progress for visibility
      const lines = text.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        addTaskLog(taskId, 'progress', line.slice(0, 200));
      }
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
