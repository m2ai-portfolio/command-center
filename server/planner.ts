import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { classifyIntent } from './orchestrator.js';
import type { MissionPlan, MissionSubtask } from '../shared/types.js';

/**
 * Mission Planner (Phase 5.1) — Sonnet decomposes goals into subtasks.
 *
 * Every mission goes through the planner. Simple missions return a single
 * subtask (no-op decomposition). Complex missions get broken into ordered
 * subtasks with dependencies and per-subtask agent assignments.
 */

interface PlannerSubtask {
  description: string;
  task_type: string;
  depends_on: number[];  // indices into the array
}

const PLANNER_SYSTEM_PROMPT = `You are a mission planner for an AI agent orchestration system called CMD.

Your job: decompose a user's goal into ordered subtasks that can be executed by specialized agents.

## Agent Types Available
- **coding**: Software engineering — build, fix, refactor, debug, test, deploy
- **research**: Web research, analysis, investigation, comparison, summarization
- **content**: Writing — blog posts, emails, documentation, social media, copy
- **ops**: DevOps — deploy, restart, configure, migrate, backup, monitor
- **general**: Anything that doesn't fit the above

## Rules
1. Return a JSON array of subtasks. Each subtask has: description, task_type, depends_on (array of 0-based indices of subtasks this one depends on)
2. Keep subtasks atomic — one clear action per subtask
3. Order by dependency — earlier subtasks first
4. For simple goals that are a single action, return exactly ONE subtask
5. Never create more than 6 subtasks — if the goal seems larger, group related actions
6. depends_on must only reference earlier subtasks (lower indices)

## Output Format
Return ONLY valid JSON. No markdown, no explanation, no code fences.

Example for "Research competitors and write a blog post comparing them":
[{"description":"Research top competitors, their features, pricing, and market position","task_type":"research","depends_on":[]},{"description":"Write a comparison blog post based on the research findings","task_type":"content","depends_on":[0]}]

Example for "Fix the login bug":
[{"description":"Fix the login bug","task_type":"coding","depends_on":[]}]`;

export async function planMission(goal: string): Promise<MissionPlan> {
  let subtasks: PlannerSubtask[];

  try {
    const raw = await callPlanner(goal);
    subtasks = JSON.parse(raw);

    if (!Array.isArray(subtasks) || subtasks.length === 0) {
      throw new Error('Planner returned empty or non-array result');
    }
  } catch (err) {
    // Fallback: single subtask using keyword classification
    console.error('Planner decomposition failed, falling back to single subtask:', err);
    const classification = classifyIntent(goal);
    return {
      reasoning: `Planner fallback — classified as ${classification.task_type} (${classification.complexity}).`,
      subtasks: [{
        id: uuidv4(),
        description: goal,
        agent_id: classification.suggested_agent ?? 'claude-code',
        status: 'pending',
        result: null,
        depends_on: [],
      }],
      needs_clarification: false,
    };
  }

  // Convert planner output to MissionSubtask[] with agent assignments
  const missionSubtasks: MissionSubtask[] = subtasks.map((st, idx) => {
    // Use classifyIntent to find the best agent for each subtask
    const classification = classifyIntent(st.description);

    // Map numeric depends_on indices to subtask IDs (assigned below)
    const id = uuidv4();

    return {
      id,
      description: st.description,
      agent_id: classification.suggested_agent ?? 'claude-code',
      status: 'pending' as const,
      result: null,
      depends_on: [], // resolved below
    };
  });

  // Resolve depends_on indices to subtask IDs
  for (let i = 0; i < subtasks.length; i++) {
    const deps = subtasks[i].depends_on ?? [];
    missionSubtasks[i].depends_on = deps
      .filter(idx => idx >= 0 && idx < i) // only valid earlier indices
      .map(idx => missionSubtasks[idx].id);
  }

  // Build reasoning summary
  const taskTypes = subtasks.map(s => s.task_type);
  const uniqueTypes = [...new Set(taskTypes)];
  const isMultiDomain = uniqueTypes.length > 1;
  const reasoning = isMultiDomain
    ? `Planner decomposed into ${subtasks.length} subtasks across [${uniqueTypes.join(', ')}]. Dependencies: ${subtasks.some(s => s.depends_on.length > 0) ? 'yes' : 'none'}.`
    : `Planner: ${subtasks.length} subtask(s), type: ${uniqueTypes[0]}.`;

  return {
    reasoning,
    subtasks: missionSubtasks,
    needs_clarification: false,
  };
}

function callPlanner(goal: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--print', `Decompose this goal into subtasks:\n\n${goal}`,
      '--output-format', 'text',
      '--append-system-prompt', PLANNER_SYSTEM_PROMPT,
      '--max-turns', '1',
      '--model', 'sonnet',
    ];

    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const child = spawn('claude', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        // Strip markdown code fences if present
        let result = stdout.trim();
        result = result.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
        resolve(result.trim());
      } else {
        reject(new Error(`Planner exited with code ${code}: ${stderr.trim()}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn planner: ${err.message}`));
    });
  });
}
