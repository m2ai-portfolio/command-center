import { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../api';

interface StockAgent {
  id: string;
  name: string;
  description: string;
  category: string;
  source: string;
  skills: string[];
}

export function StockAgents() {
  const [agents, setAgents] = useState<StockAgent[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadingAgent, setLoadingAgent] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadAgents = useCallback(() => {
    setLoading(true);
    api.listStockAgents()
      .then(data => {
        setAgents(data.agents as StockAgent[]);
        setCategories(data.categories);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const filtered = useMemo(() => {
    let list = agents;
    if (selectedCategory) {
      list = list.filter(a => a.category === selectedCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.skills.some(s => s.includes(q))
      );
    }
    return list;
  }, [agents, selectedCategory, search]);

  const handleSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      await api.syncStockRepos();
      loadAgents();
      setMessage({ text: 'Repos synced successfully', type: 'success' });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const handleLoad = async (agentId: string) => {
    setLoadingAgent(agentId);
    setMessage(null);
    try {
      await api.loadStockAgent(agentId);
      setMessage({ text: `Loaded "${agentId}" into agent registry`, type: 'success' });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), type: 'error' });
    } finally {
      setLoadingAgent(null);
    }
  };

  const handleLoadCategory = async (category: string) => {
    setLoadingAgent(`cat:${category}`);
    setMessage(null);
    try {
      const res = await api.loadStockCategory(category);
      setMessage({ text: `Loaded ${(res.agents as unknown[]).length} agents from "${category}"`, type: 'success' });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), type: 'error' });
    } finally {
      setLoadingAgent(null);
    }
  };

  // Group by category for the sidebar counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of agents) {
      counts[a.category] = (counts[a.category] || 0) + 1;
    }
    return counts;
  }, [agents]);

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Stock Agents</h1>
          <p className="text-sm text-gray-500 mt-1">
            {agents.length} agents across {categories.length} categories
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
        >
          {syncing ? 'Syncing...' : 'Sync Repos'}
        </button>
      </div>

      {message && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-900/50 text-green-300 border border-green-800' : 'bg-red-900/50 text-red-300 border border-red-800'
        }`}>
          {message.text}
        </div>
      )}

      <div className="flex gap-6">
        {/* Category sidebar */}
        <div className="w-56 shrink-0">
          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={() => setSelectedCategory(null)}
            className={`w-full text-left px-3 py-1.5 rounded text-sm mb-1 ${
              !selectedCategory ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            All <span className="text-gray-600 ml-1">({agents.length})</span>
          </button>

          <div className="max-h-[60vh] overflow-y-auto space-y-0.5">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`w-full text-left px-3 py-1.5 rounded text-sm flex items-center justify-between ${
                  selectedCategory === cat ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <span className="truncate">{cat}</span>
                <span className="text-xs text-gray-600 ml-2 shrink-0">{categoryCounts[cat]}</span>
              </button>
            ))}
          </div>

          {selectedCategory && (
            <button
              onClick={() => handleLoadCategory(selectedCategory)}
              disabled={loadingAgent === `cat:${selectedCategory}`}
              className="w-full mt-3 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
            >
              {loadingAgent === `cat:${selectedCategory}` ? 'Loading...' : `Load all ${selectedCategory}`}
            </button>
          )}
        </div>

        {/* Agent list */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="text-center py-16 text-gray-500">Loading stock agents...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              {search || selectedCategory ? 'No agents match your filters' : 'No stock agents found. Try syncing repos.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(agent => (
                <div
                  key={agent.id}
                  className="p-3 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-100 text-sm">{agent.name}</h3>
                        <span className="text-xs text-gray-600">{agent.source}</span>
                      </div>
                      {agent.description && (
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{agent.description}</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded text-xs">
                          {agent.category}
                        </span>
                        {agent.skills.filter(s => s !== agent.category).slice(0, 4).map(skill => (
                          <span key={skill} className="px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded text-xs">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => handleLoad(agent.id)}
                      disabled={loadingAgent === agent.id}
                      className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-blue-600 disabled:bg-gray-800 disabled:text-gray-500 rounded font-medium transition-colors shrink-0"
                    >
                      {loadingAgent === agent.id ? 'Loading...' : 'Load'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
