import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';

interface Subtask {
  id: string;
  description: string;
  agent_id: string;
  status: string;
  result: string | null;
  depends_on: string[];
  duration_ms?: number | null;
  task_type?: string;
}

interface Mission {
  id: string;
  goal: string;
  status: string;
  created_at: number;
  updated_at: number;
  plan: { reasoning: string; subtasks: Subtask[] } | null;
  result: string | null;
  duration_ms: number | null;
  agent_id: string | null;
}

interface JudgeVerdict {
  passed: boolean;
  quality_scores: { correctness: number; completeness: number; relevance: number };
  composite_score: number;
  reasoning: string;
  evaluated_at: number;
  method: string;
}

interface Log {
  id: number;
  timestamp: number;
  level: string;
  message: string;
  agent_id: string | null;
}

export function MissionDetail() {
  const { id } = useParams<{ id: string }>();
  const [mission, setMission] = useState<Mission | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [verdict, setVerdict] = useState<JudgeVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSubtask, setExpandedSubtask] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api.getMission(id)
      .then((data: Record<string, unknown>) => {
        setMission(data.mission as Mission);
        setLogs(data.logs as Log[]);
        if (data.judge_verdict) setVerdict(data.judge_verdict as JudgeVerdict);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleApprove = async () => {
    if (!id) return;
    try {
      await api.approveMission(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCancel = async () => {
    if (!id) return;
    try {
      await api.cancelMission(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error && !mission) {
    return (
      <div className="max-w-4xl">
        <Link to="/" className="text-blue-400 hover:text-blue-300 text-sm mb-4 inline-block">&larr; Back to missions</Link>
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (!mission) {
    return <div className="text-gray-500">Loading...</div>;
  }

  const statusColor: Record<string, string> = {
    proposed: 'text-blue-400',
    running: 'text-yellow-400',
    completed: 'text-green-400',
    failed: 'text-red-400',
    cancelled: 'text-gray-500',
  };

  const logLevelIcon: Record<string, string> = {
    info: 'text-blue-400',
    progress: 'text-yellow-400',
    error: 'text-red-400',
    result: 'text-green-400',
  };

  const subtasks = mission.plan?.subtasks ?? [];
  const isMultiSubtask = subtasks.length > 1;

  return (
    <div className="max-w-4xl">
      <Link to="/" className="text-blue-400 hover:text-blue-300 text-sm mb-4 inline-block">&larr; Back to missions</Link>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <span className={`text-sm font-semibold uppercase ${statusColor[mission.status] ?? 'text-gray-400'}`}>
            {mission.status}
          </span>
          {mission.duration_ms && (
            <span className="text-xs text-gray-500">{Math.round(mission.duration_ms / 1000)}s</span>
          )}
          {mission.agent_id && (
            <span className="text-xs text-gray-600">Agent: {mission.agent_id}</span>
          )}
          {isMultiSubtask && (
            <span className="px-2 py-0.5 bg-purple-900/50 text-purple-300 rounded text-xs">
              {subtasks.length} subtasks
            </span>
          )}
        </div>
        <h1 className="text-xl font-bold text-gray-100">{mission.goal}</h1>
        <p className="text-xs text-gray-500 mt-1">
          ID: {mission.id} | Created: {new Date(mission.created_at * 1000).toLocaleString()}
        </p>
      </div>

      {/* Actions */}
      {mission.status === 'proposed' && (
        <div className="flex gap-3 mb-6">
          <button
            onClick={handleApprove}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-medium transition-colors"
          >
            Approve & Execute
          </button>
          <button
            onClick={handleCancel}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {(mission.status === 'running') && (
        <div className="flex gap-3 mb-6">
          <button
            onClick={handleCancel}
            className="px-4 py-2 bg-red-800 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors"
          >
            Cancel Mission
          </button>
        </div>
      )}

      {error && <p className="mb-4 text-red-400 text-sm">{error}</p>}

      {/* Subtask Timeline (Phase 5.6) */}
      {mission.plan && subtasks.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
            {isMultiSubtask ? 'Subtask Timeline' : 'Plan'}
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p className="text-sm text-gray-400 mb-3">{mission.plan.reasoning}</p>
            <div className="space-y-2">
              {subtasks.map((st, i) => (
                <div key={st.id} className="group">
                  <div
                    className={`flex items-center gap-3 py-2 px-3 rounded-lg transition-colors ${
                      st.result ? 'cursor-pointer hover:bg-gray-800/50' : ''
                    }`}
                    onClick={() => st.result && setExpandedSubtask(expandedSubtask === st.id ? null : st.id)}
                  >
                    {/* Status indicator */}
                    <div className="flex flex-col items-center">
                      <SubtaskStatusIcon status={st.status} />
                      {i < subtasks.length - 1 && (
                        <div className={`w-0.5 h-4 mt-1 ${
                          st.status === 'completed' ? 'bg-green-800' : 'bg-gray-700'
                        }`} />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-200">{st.description}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-600">{st.agent_id}</span>
                        {st.task_type && (
                          <span className="text-xs text-gray-700">{st.task_type}</span>
                        )}
                        {st.depends_on.length > 0 && (
                          <span className="text-xs text-gray-700">
                            depends on: {st.depends_on.map(d => {
                              const depIdx = subtasks.findIndex(s => s.id === d);
                              return depIdx >= 0 ? `#${depIdx + 1}` : '?';
                            }).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Duration + status badge */}
                    <div className="flex items-center gap-2 shrink-0">
                      {st.duration_ms && (
                        <span className="text-xs text-gray-500">{Math.round(st.duration_ms / 1000)}s</span>
                      )}
                      <SubtaskBadge status={st.status} />
                      {st.result && (
                        <span className="text-xs text-gray-600 group-hover:text-gray-400">
                          {expandedSubtask === st.id ? '▼' : '▶'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Expanded result */}
                  {expandedSubtask === st.id && st.result && (
                    <div className="ml-10 mt-1 mb-2">
                      <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-gray-400 whitespace-pre-wrap overflow-auto max-h-48">
                        {st.result}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Judge Verdict (Phase 5.6) */}
      {verdict && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Judge Verdict</h2>
          <div className={`bg-gray-900 border rounded-lg p-4 ${
            verdict.passed ? 'border-green-800/50' : 'border-red-800/50'
          }`}>
            {/* Header: pass/fail + composite */}
            <div className="flex items-center gap-3 mb-4">
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                verdict.passed
                  ? 'bg-green-900/50 text-green-300 border border-green-700/50'
                  : 'bg-red-900/50 text-red-300 border border-red-700/50'
              }`}>
                {verdict.passed ? 'PASS' : 'FAIL'}
              </span>
              <span className="text-2xl font-bold text-gray-100">
                {Math.round(verdict.composite_score * 100)}%
              </span>
              <span className="text-xs text-gray-500 ml-auto">
                {verdict.method} | {new Date(verdict.evaluated_at * 1000).toLocaleTimeString()}
              </span>
            </div>

            {/* Dimension bars */}
            <div className="space-y-2 mb-4">
              <DimensionBar label="Correctness" value={verdict.quality_scores.correctness} />
              <DimensionBar label="Completeness" value={verdict.quality_scores.completeness} />
              <DimensionBar label="Relevance" value={verdict.quality_scores.relevance} />
            </div>

            {/* Reasoning */}
            <p className="text-xs text-gray-400">{verdict.reasoning}</p>
          </div>
        </section>
      )}

      {/* Result */}
      {mission.result && !isMultiSubtask && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Result</h2>
          <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm text-gray-300 whitespace-pre-wrap overflow-auto max-h-96">
            {mission.result}
          </pre>
        </section>
      )}

      {/* Logs */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Logs ({logs.length})
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
          {logs.map((log) => (
            <div key={log.id} className="px-4 py-2 flex items-start gap-3 text-sm">
              <span className="text-xs text-gray-500 whitespace-nowrap mt-0.5">
                {new Date(log.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={`mt-0.5 ${logLevelIcon[log.level] ?? 'text-gray-400'}`}>
                {log.level === 'info' ? 'i' : log.level === 'progress' ? '>' : log.level === 'error' ? '!' : '*'}
              </span>
              <span className="text-gray-300 flex-1">{log.message}</span>
              {log.agent_id && (
                <span className="text-xs text-gray-600">{log.agent_id}</span>
              )}
            </div>
          ))}
          {logs.length === 0 && (
            <p className="px-4 py-3 text-gray-500 text-sm">No logs yet</p>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Subtask Components ──────────────────────────────────────────

function SubtaskStatusIcon({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-green-500',
    running: 'bg-yellow-500 animate-pulse',
    retrying: 'bg-orange-500 animate-pulse',
    failed: 'bg-red-500',
    cancelled: 'bg-gray-600',
    queued: 'bg-blue-500',
    pending: 'bg-gray-500',
  };
  return <div className={`w-2.5 h-2.5 rounded-full ${styles[status] ?? 'bg-gray-500'}`} />;
}

function SubtaskBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-green-900/50 text-green-400',
    running: 'bg-yellow-900/50 text-yellow-400',
    retrying: 'bg-orange-900/50 text-orange-400',
    failed: 'bg-red-900/50 text-red-400',
    cancelled: 'bg-gray-800 text-gray-500',
    queued: 'bg-blue-900/50 text-blue-400',
    pending: 'bg-gray-800 text-gray-500',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs ${styles[status] ?? 'bg-gray-800 text-gray-500'}`}>
      {status}
    </span>
  );
}

function DimensionBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const barColor = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-28">{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-300 w-10 text-right">{pct}%</span>
    </div>
  );
}
