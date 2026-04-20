import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type HivemindEvent } from '../api';

const EVENT_TYPES = [
  'mission_start',
  'mission_end',
  'agent_dispatch',
  'agent_complete',
  'agent_fail',
  'judge_verdict',
  'reasoner_action',
  'subtask_start',
  'subtask_complete',
] as const;

const EVENT_COLOR: Record<string, string> = {
  mission_start: 'text-blue-300',
  mission_end: 'text-blue-400',
  agent_dispatch: 'text-indigo-300',
  agent_complete: 'text-emerald-400',
  agent_fail: 'text-red-400',
  judge_verdict: 'text-amber-300',
  reasoner_action: 'text-fuchsia-400',
  subtask_start: 'text-cyan-300',
  subtask_complete: 'text-cyan-400',
};

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtAge(ts: number, now: number): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function HiveMind() {
  const [events, setEvents] = useState<HivemindEvent[]>([]);
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    try {
      const data = await api.listHivemindEvents({
        agent: agentFilter || undefined,
        type: typeFilter || undefined,
        limit: 200,
      });
      setEvents(data.events);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentFilter, typeFilter]);

  useEffect(() => {
    load();
    const int = setInterval(load, 5_000);
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => { clearInterval(int); clearInterval(tick); };
  }, [load]);

  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (e.agent_id) set.add(e.agent_id);
    return Array.from(set).sort();
  }, [events]);

  const counts = useMemo(() => {
    const byType: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    for (const e of events) {
      byType[e.event_type] = (byType[e.event_type] ?? 0) + 1;
      if (e.agent_id) byAgent[e.agent_id] = (byAgent[e.agent_id] ?? 0) + 1;
    }
    return { byType, byAgent };
  }, [events]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">HiveMind</h1>
          <p className="text-sm text-gray-500 mt-1">
            Cross-agent activity log — every mission lifecycle event, across every agent.
          </p>
        </div>
        <span className="text-xs text-gray-600">auto-refresh 5s</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm"
        >
          <option value="">All agents ({agents.length})</option>
          {agents.map((a) => (
            <option key={a} value={a}>
              {a} ({counts.byAgent[a] ?? 0})
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm"
        >
          <option value="">All event types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t} ({counts.byType[t] ?? 0})
            </option>
          ))}
        </select>
        {(agentFilter || typeFilter) && (
          <button
            onClick={() => { setAgentFilter(''); setTypeFilter(''); }}
            className="text-sm text-gray-400 hover:text-white underline-offset-2 hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 text-red-300 rounded p-3 text-sm mb-4">
          {error}
        </div>
      )}

      {loading && events.length === 0 && (
        <p className="text-gray-500 text-sm">Loading events…</p>
      )}

      {!loading && events.length === 0 && !error && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400">No events yet.</p>
          <p className="text-xs text-gray-600 mt-1">
            Events accumulate as missions run. Try approving a mission from the Dashboard.
          </p>
        </div>
      )}

      {events.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-950 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left w-20">Time</th>
                <th className="px-3 py-2 text-left w-16">Age</th>
                <th className="px-3 py-2 text-left w-40">Type</th>
                <th className="px-3 py-2 text-left w-32">Agent</th>
                <th className="px-3 py-2 text-left">Summary</th>
                <th className="px-3 py-2 text-left w-20">Mission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-gray-800/50">
                  <td className="px-3 py-2 font-mono text-gray-400">{fmtTime(e.ts)}</td>
                  <td className="px-3 py-2 text-gray-500">{fmtAge(e.ts, now)}</td>
                  <td className={`px-3 py-2 font-mono text-xs ${EVENT_COLOR[e.event_type] ?? 'text-gray-300'}`}>
                    {e.event_type}
                  </td>
                  <td className="px-3 py-2 text-gray-300">{e.agent_id ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-200">{e.summary}</td>
                  <td className="px-3 py-2">
                    {e.mission_id ? (
                      <Link
                        to={`/mission/${e.mission_id}`}
                        className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                        title={e.mission_id}
                      >
                        {e.mission_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
