import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import {
  createMission,
  getMission,
  updateMission,
  addMissionLog,
  listAgents,
  updateAgentStatus,
  logOutcome,
} from './db.js';
import type { Mission, MissionPlan, AgentCard } from '../shared/types.js';
import type { A2ATaskRequest, A2ATaskStatus } from '../shared/a2a.js';

// ── A2A Agent Registry ───────────────────────────────────────────────
// Maps agent IDs to their A2A endpoint URLs

const a2aEndpoints = new Map<string, string>();

export function registerA2AAgent(agentId: string, endpoint: string): void {
  a2aEndpoints.set(agentId, endpoint);
}

/** Try to discover an agent's A2A card. Returns true if successful. */
export async function discoverAgent(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/.well-known/agent.json`);
    if (!res.ok) return false;
    const card = await res.json();
    a2aEndpoints.set(card.id, endpoint);
    return true;
  } catch {
    return false;
  }
}

// ── Intent Classification ────────────────────────────────────────────

interface ClassificationResult {
  task_type: 'research' | 'coding' | 'content' | 'ops' | 'general';
  complexity: 'simple' | 'moderate' | 'complex';
  suggested_agent: string | null;
  reasoning: string;
}

export function classifyIntent(goal: string): ClassificationResult {
  const lower = goal.toLowerCase();

  const codingKeywords = /\b(build|code|implement|fix|refactor|debug|create.*app|write.*function|add.*feature|test|deploy)\b/;
  const researchKeywords = /\b(research|find|search|look up|investigate|analyze|compare|what is|how does|summarize)\b/;
  const contentKeywords = /\b(write|draft|blog|post|email|article|documentation|content|social media|copy)\b/;
  const opsKeywords = /\b(deploy|restart|update|install|configure|migrate|backup|monitor|server|docker|container)\b/;

  let task_type: ClassificationResult['task_type'] = 'general';
  if (codingKeywords.test(lower)) task_type = 'coding';
  else if (researchKeywords.test(lower)) task_type = 'research';
  else if (contentKeywords.test(lower)) task_type = 'content';
  else if (opsKeywords.test(lower)) task_type = 'ops';

  const complexity = lower.length > 200 || lower.includes(' and ') || lower.includes(' then ')
    ? 'complex'
    : lower.length > 80 ? 'moderate' : 'simple';

  const agents = listAgents() as AgentCard[];
  const matched = agents.find(a =>
    a.skills.some((s: string) => s.toLowerCase() === task_type) && a.status === 'available'
  );

  return {
    task_type,
    complexity,
    suggested_agent: matched?.id ?? (agents.find(a => a.status === 'available')?.id ?? null),
    reasoning: `Classified as ${task_type} (${complexity}). ${matched ? `Matched agent: ${matched.name}` : 'No specific agent matched — will use default.'}`,
  };
}

// ── Mission Lifecycle ────────────────────────────────────────────────

export function proposeMission(goal: string): { mission: Mission; classification: ClassificationResult } {
  const id = uuidv4();
  const classification = classifyIntent(goal);

  createMission(id, goal);

  const plan: MissionPlan = {
    reasoning: classification.reasoning,
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

  updateMission(id, {
    plan,
    agent_id: classification.suggested_agent ?? 'claude-code',
  });

  addMissionLog(id, 'info', `Mission proposed: ${goal}`);
  addMissionLog(id, 'info', `Classification: ${classification.task_type} (${classification.complexity})`);
  if (classification.suggested_agent) {
    addMissionLog(id, 'info', `Suggested agent: ${classification.suggested_agent}`);
  }

  const mission = getMission(id) as Mission;
  return { mission, classification };
}

export async function approveMission(missionId: string): Promise<void> {
  const mission = getMission(missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found`);

  updateMission(missionId, { status: 'running' });
  addMissionLog(missionId, 'info', 'Mission approved — executing');

  const agentId = (mission.agent_id as string) ?? 'claude-code';
  updateAgentStatus(agentId, 'busy', missionId);

  const startTime = Date.now();

  try {
    addMissionLog(missionId, 'progress', `Dispatching to agent: ${agentId}`);

    // Try A2A dispatch first, fall back to direct Claude Code
    const a2aEndpoint = a2aEndpoints.get(agentId);
    let result: string;

    if (a2aEndpoint) {
      addMissionLog(missionId, 'info', `Using A2A protocol → ${a2aEndpoint}`);
      result = await executeViaA2A(a2aEndpoint, missionId, mission.goal as string);
    } else {
      addMissionLog(missionId, 'info', 'No A2A endpoint — using direct Claude Code');
      result = await executeViaClaudeCode(mission.goal as string, missionId);
    }

    const durationMs = Date.now() - startTime;
    updateMission(missionId, {
      status: 'completed',
      result,
      duration_ms: durationMs,
    });
    addMissionLog(missionId, 'result', result);
    addMissionLog(missionId, 'info', `Mission completed in ${Math.round(durationMs / 1000)}s`);

    // Log outcome for routing quality tracking
    const planReasoning = mission.plan?.reasoning ?? '';
    const taskType = planReasoning.match(/Classified as (\w+)/)?.[1] ?? 'unknown';
    logOutcome(missionId, taskType, agentId, planReasoning, 'completed', durationMs);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);
    updateMission(missionId, {
      status: 'failed',
      result: errMsg,
      duration_ms: durationMs,
    });
    addMissionLog(missionId, 'error', `Mission failed: ${errMsg}`);

    const planReasoning = mission.plan?.reasoning ?? '';
    const taskType = planReasoning.match(/Classified as (\w+)/)?.[1] ?? 'unknown';
    logOutcome(missionId, taskType, agentId, planReasoning, 'failed', durationMs);
  } finally {
    updateAgentStatus(agentId, 'available', null);
  }
}

export function cancelMission(missionId: string): void {
  updateMission(missionId, { status: 'cancelled' });
  addMissionLog(missionId, 'info', 'Mission cancelled');
}

// ── A2A Dispatch ─────────────────────────────────────────────────────

async function executeViaA2A(endpoint: string, missionId: string, goal: string): Promise<string> {
  const taskId = uuidv4();

  // Submit task
  const taskReq: A2ATaskRequest = {
    id: taskId,
    goal,
    sender: { id: 'data-orchestrator', name: 'Data' },
    timeout_ms: 600_000,
  };

  const submitRes = await fetch(`${endpoint}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(taskReq),
  });

  if (!submitRes.ok) {
    throw new Error(`A2A task submission failed: ${submitRes.status} ${await submitRes.text()}`);
  }

  addMissionLog(missionId, 'progress', `A2A task ${taskId.slice(0, 8)} submitted, polling...`);

  // Poll for completion
  const maxWait = 660_000; // 11 min (give agent 10 min + buffer)
  const pollInterval = 3_000;
  const startPoll = Date.now();

  while (Date.now() - startPoll < maxWait) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    const statusRes = await fetch(`${endpoint}/task/${taskId}`);
    if (!statusRes.ok) continue;

    const status = await statusRes.json() as A2ATaskStatus;

    if (status.state === 'completed') {
      return status.result ?? '(no output)';
    }

    if (status.state === 'failed') {
      throw new Error(`Agent failed: ${status.error ?? 'unknown error'}`);
    }

    // Log progress if there's a new message
    if (status.progress) {
      addMissionLog(missionId, 'progress', `Agent: ${status.progress}`);
    }
  }

  throw new Error('A2A task timed out waiting for agent response');
}

// ── Direct Claude Code Dispatch (fallback) ───────────────────────────

function executeViaClaudeCode(prompt: string, missionId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['--print', prompt, '--output-format', 'text'];

    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    addMissionLog(missionId, 'progress', 'Starting Claude Code session...');

    const child = spawn('claude', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 600_000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim() || '(no output)');
      else reject(new Error(`Claude Code exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
    });
  });
}
