import { useEffect, useState, useCallback } from 'react';

interface StageCount { status: string; count: number }
interface IdeaRow { id: number; title: string; weighted_score: number | null; status: string }

interface IdeaForgeData {
  warning?: string;
  signals_last_7d: number;
  total_ideas: number;
  built_count: number;
  stage_breakdown: StageCount[];
  top_ideas: IdeaRow[];
  anomaly_count: number;
}

const EMPTY: IdeaForgeData = {
  signals_last_7d: 0,
  total_ideas: 0,
  built_count: 0,
  stage_breakdown: [],
  top_ideas: [],
  anomaly_count: 0,
};

function KpiCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col gap-1">
      <span className={`text-2xl font-bold ${accent ?? 'text-white'}`}>{value}</span>
      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  unscored: 'bg-gray-600',
  scored: 'bg-blue-600',
  classified: 'bg-indigo-600',
  approved: 'bg-green-600',
  dismissed: 'bg-red-700',
  exported: 'bg-yellow-500',
  built: 'bg-emerald-500',
  published: 'bg-teal-400',
};

export function StMetro() {
  const [data, setData] = useState<IdeaForgeData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch('/api/st-metro/ideaforge')
      .then((r) => r.json())
      .then((d: IdeaForgeData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const maxCount = Math.max(1, ...data.stage_breakdown.map((s) => s.count));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">ST Metro</h1>
          <p className="text-sm text-gray-500 mt-0.5">IdeaForge pipeline state</p>
        </div>
        {loading && <span className="text-xs text-gray-600 animate-pulse">Loading...</span>}
      </div>

      {data.warning && (
        <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
          {data.warning}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Signals (7d)" value={data.signals_last_7d} accent="text-blue-400" />
        <KpiCard label="Total Ideas" value={data.total_ideas} />
        <KpiCard label="Built" value={data.built_count} accent="text-emerald-400" />
        <KpiCard
          label="Scoring Stalls"
          value={data.anomaly_count}
          accent={data.anomaly_count > 0 ? 'text-red-400' : 'text-gray-400'}
        />
      </div>

      {/* Stage breakdown */}
      {data.stage_breakdown.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Stage Breakdown
          </h2>
          <div className="space-y-2">
            {data.stage_breakdown
              .slice()
              .sort((a, b) => b.count - a.count)
              .map((s) => (
                <div key={s.status} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-24 text-right capitalize">{s.status}</span>
                  <div className="flex-1 bg-gray-800 rounded h-4 overflow-hidden">
                    <div
                      className={`h-full rounded ${STATUS_COLOR[s.status] ?? 'bg-gray-500'}`}
                      style={{ width: `${Math.max(2, (s.count / maxCount) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-8">{s.count}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Top 10 ideas */}
      {data.top_ideas.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Top 10 Ideas by Score
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-600 uppercase">
                <th className="text-left pb-2 font-medium">#</th>
                <th className="text-left pb-2 font-medium">Title</th>
                <th className="text-left pb-2 font-medium">Status</th>
                <th className="text-right pb-2 font-medium">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {data.top_ideas.map((idea, i) => (
                <tr key={idea.id} className="hover:bg-gray-800/50">
                  <td className="py-2 pr-2 text-gray-600 w-6">{i + 1}</td>
                  <td className="py-2 pr-4 text-gray-200">{idea.title}</td>
                  <td className="py-2 pr-4">
                    <span className="text-xs text-gray-500 capitalize">{idea.status}</span>
                  </td>
                  <td className="py-2 text-right font-mono text-blue-300">
                    {idea.weighted_score !== null ? idea.weighted_score.toFixed(2) : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && data.top_ideas.length === 0 && !data.warning && (
        <p className="text-sm text-gray-600">No scored ideas yet.</p>
      )}
    </div>
  );
}
