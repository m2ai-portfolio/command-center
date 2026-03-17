import express from 'express';
import cors from 'cors';
import fs from 'fs';
import type { AgentConfig } from './agent-config.js';
import type { A2AAgentCard, A2ATaskRequest, A2ATaskResponse, A2ATaskStatus } from '../../shared/a2a.js';
import { createTask, getTask, addTaskLog } from './task-store.js';
import { executeTask } from './executor.js';

/**
 * Start an A2A-compliant agent server.
 * This is the generic runtime shell — any agent config + system prompt
 * can be loaded to create a specialist agent.
 */
export function startAgentServer(config: AgentConfig): void {
  // Load system prompt
  let systemPrompt = config.system_prompt ?? '';
  if (config.system_prompt_path && !systemPrompt) {
    try {
      systemPrompt = fs.readFileSync(config.system_prompt_path, 'utf-8');
    } catch (err) {
      console.error(`Failed to load system prompt from ${config.system_prompt_path}:`, err);
      process.exit(1);
    }
  }

  const app = express();
  app.use(cors());
  app.use(express.json());

  // ── A2A: Agent Card ──────────────────────────────────────────────
  const agentCard: A2AAgentCard = {
    id: config.id,
    name: config.name,
    description: config.description,
    skills: config.skills,
    type: config.type,
    protocol_version: '0.1',
    endpoint: `http://localhost:${config.port}`,
    accepts: config.accepts,
    produces: config.produces,
  };

  app.get('/.well-known/agent.json', (_req, res) => {
    res.json(agentCard);
  });

  // ── A2A: Submit Task ─────────────────────────────────────────────
  app.post('/task', (req, res) => {
    const body = req.body as A2ATaskRequest;

    if (!body.id || !body.goal) {
      res.status(400).json({ error: 'id and goal are required' });
      return;
    }

    const task = createTask(
      body.id,
      body.goal,
      body.sender?.id ?? 'unknown',
      body.sender?.name ?? 'unknown',
      body.context,
    );

    addTaskLog(task.id, 'info', `Task received from ${body.sender?.name ?? 'unknown'}`);

    // Fire-and-forget execution
    executeTask(
      task.id,
      body.goal,
      systemPrompt,
      body.context,
      body.timeout_ms ?? config.timeout_ms,
    ).catch((err) => {
      console.error(`Task ${task.id} execution error:`, err);
    });

    const response: A2ATaskResponse = {
      task_id: task.id,
      state: 'queued',
      estimated_seconds: Math.round(config.timeout_ms / 1000 / 2),
    };

    res.status(202).json(response);
  });

  // ── A2A: Task Status ─────────────────────────────────────────────
  app.get('/task/:id', (req, res) => {
    const task = getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const status: A2ATaskStatus = {
      task_id: task.id,
      state: task.state,
      progress: task.logs.length > 0 ? task.logs[task.logs.length - 1].message : undefined,
      result: task.result,
      error: task.error,
      duration_ms: task.duration_ms,
      logs: task.logs,
    };

    res.json(status);
  });

  // ── Health ───────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agent: config.id });
  });

  // ── Start ────────────────────────────────────────────────────────
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[${config.name}] A2A agent running on port ${config.port}`);
    console.log(`[${config.name}] Agent card: http://localhost:${config.port}/.well-known/agent.json`);
  });
}
