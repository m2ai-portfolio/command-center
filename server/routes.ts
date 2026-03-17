import { Router } from 'express';
import {
  getMission,
  listMissions,
  getMissionLogs,
  listAgents,
  getOutcomeStats,
} from './db.js';
import {
  proposeMission,
  approveMission,
  cancelMission,
} from './orchestrator.js';
import type { CreateMissionRequest } from '../shared/types.js';

export const router = Router();

// ── Missions ─────────────────────────────────────────────────────────

router.get('/missions', (_req, res) => {
  const missions = listMissions();
  res.json({ missions });
});

router.get('/missions/:id', (req, res) => {
  const mission = getMission(req.params.id);
  if (!mission) {
    res.status(404).json({ error: 'Mission not found' });
    return;
  }
  const logs = getMissionLogs(req.params.id);
  res.json({ mission, logs });
});

router.post('/missions', (req, res) => {
  const { goal } = req.body as CreateMissionRequest;
  if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
    res.status(400).json({ error: 'Goal is required' });
    return;
  }
  const { mission, classification } = proposeMission(goal.trim());
  res.status(201).json({ mission, classification });
});

router.post('/missions/:id/approve', (req, res) => {
  const mission = getMission(req.params.id);
  if (!mission) {
    res.status(404).json({ error: 'Mission not found' });
    return;
  }
  if (mission.status !== 'proposed') {
    res.status(400).json({ error: `Cannot approve mission in status: ${mission.status}` });
    return;
  }

  // Fire-and-forget — mission runs in background
  approveMission(req.params.id).catch((err) => {
    console.error('Mission execution error:', err);
  });

  res.json({ message: 'Mission approved and running', mission_id: req.params.id });
});

router.post('/missions/:id/cancel', (req, res) => {
  const mission = getMission(req.params.id);
  if (!mission) {
    res.status(404).json({ error: 'Mission not found' });
    return;
  }

  cancelMission(req.params.id);
  res.json({ message: 'Mission cancelled', mission_id: req.params.id });
});

// ── Agents ───────────────────────────────────────────────────────────

router.get('/agents', (_req, res) => {
  const agents = listAgents();
  res.json({ agents });
});

// ── Status (for DataTG queries) ──────────────────────────────────────

router.get('/status', (_req, res) => {
  const missions = listMissions(10);
  const active = missions.filter((m: Record<string, unknown>) =>
    m.status === 'running' || m.status === 'proposed'
  );
  const recent = missions.filter((m: Record<string, unknown>) =>
    m.status === 'completed' || m.status === 'failed'
  ).slice(0, 5);

  res.json({
    active_count: active.length,
    active: active.map((m: Record<string, unknown>) => ({
      id: m.id,
      goal: (m.goal as string).slice(0, 100),
      status: m.status,
    })),
    recent_completed: recent.map((m: Record<string, unknown>) => ({
      id: m.id,
      goal: (m.goal as string).slice(0, 100),
      status: m.status,
      duration_ms: m.duration_ms,
    })),
  });
});

router.get('/status/:id', (req, res) => {
  const mission = getMission(req.params.id);
  if (!mission) {
    res.status(404).json({ error: 'Mission not found' });
    return;
  }
  const logs = getMissionLogs(req.params.id);
  const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;

  res.json({
    mission_id: mission.id,
    status: mission.status,
    summary: (lastLog as Record<string, unknown> | null)?.message ?? mission.goal,
    progress_pct: mission.status === 'completed' ? 100 : mission.status === 'running' ? 50 : 0,
  });
});

// ── Outcome Stats ────────────────────────────────────────────────────

router.get('/stats', (_req, res) => {
  const stats = getOutcomeStats();
  res.json({ stats });
});
