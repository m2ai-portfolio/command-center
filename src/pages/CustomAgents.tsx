import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

interface CustomAgent {
  id: string;
  name: string;
  description: string;
  skills: string[];
  system_prompt: string;
  created_at: number;
  updated_at: number;
}

const COMMON_SKILLS = [
  'coding', 'debugging', 'testing', 'refactoring', 'git',
  'research', 'analysis', 'reporting', 'web-search',
  'content', 'writing', 'documentation', 'social-media', 'editing',
  'ops', 'devops', 'cloud', 'security',
  'design', 'ux', 'product', 'strategy',
  'marketing', 'sales', 'support',
];

export function CustomAgents() {
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [editing, setEditing] = useState<CustomAgent | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(() => {
    api.listCustomAgents().then(data => setAgents(data.agents as CustomAgent[]));
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const handleNew = () => {
    setEditing(null);
    setCreating(true);
    setError(null);
  };

  const handleEdit = (agent: CustomAgent) => {
    setCreating(false);
    setEditing(agent);
    setError(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete custom agent "${name}"? This cannot be undone.`)) return;
    try {
      await api.deleteCustomAgent(id);
      loadAgents();
      if (editing?.id === id) { setEditing(null); setCreating(false); }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaved = () => {
    setEditing(null);
    setCreating(false);
    setError(null);
    loadAgents();
  };

  const showForm = creating || editing !== null;

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Custom Agents</h1>
        {!showForm && (
          <button
            onClick={handleNew}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
          >
            + Create Agent
          </button>
        )}
      </div>

      {error && <p className="mb-4 text-red-400 text-sm">{error}</p>}

      {showForm ? (
        <AgentForm
          agent={editing}
          onSave={handleSaved}
          onCancel={() => { setEditing(null); setCreating(false); setError(null); }}
          onError={setError}
        />
      ) : (
        <AgentList agents={agents} onEdit={handleEdit} onDelete={handleDelete} />
      )}
    </div>
  );
}

// ── Agent List ──────────────────────────────────────────────────────

function AgentList({
  agents,
  onEdit,
  onDelete,
}: {
  agents: CustomAgent[];
  onEdit: (a: CustomAgent) => void;
  onDelete: (id: string, name: string) => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg mb-2">No custom agents yet</p>
        <p className="text-sm">Create one to get started. Custom agents run via Claude Code with your system prompt.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {agents.map(agent => (
        <div
          key={agent.id}
          className="p-4 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700 transition-colors"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-100">{agent.name}</h3>
              {agent.description && (
                <p className="text-sm text-gray-400 mt-1">{agent.description}</p>
              )}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {agent.skills.map(skill => (
                  <span key={skill} className="px-2 py-0.5 bg-gray-800 text-gray-300 rounded text-xs">
                    {skill}
                  </span>
                ))}
              </div>
              <p className="text-xs text-gray-600 mt-2">
                {agent.system_prompt.length} chars &middot; ID: {agent.id}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => onEdit(agent)}
                className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => onDelete(agent.id, agent.name)}
                className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-red-900 text-gray-400 hover:text-red-300 rounded transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Agent Form ──────────────────────────────────────────────────────

function AgentForm({
  agent,
  onSave,
  onCancel,
  onError,
}: {
  agent: CustomAgent | null;
  onSave: () => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(agent?.name ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [skills, setSkills] = useState<string[]>(agent?.skills ?? []);
  const [systemPrompt, setSystemPrompt] = useState(agent?.system_prompt ?? '');
  const [customSkill, setCustomSkill] = useState('');
  const [saving, setSaving] = useState(false);

  const isEdit = agent !== null;

  const toggleSkill = (skill: string) => {
    setSkills(prev =>
      prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
    );
  };

  const addCustomSkill = () => {
    const s = customSkill.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (s && !skills.includes(s)) {
      setSkills(prev => [...prev, s]);
    }
    setCustomSkill('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { onError('Name is required'); return; }
    if (!systemPrompt.trim()) { onError('System prompt is required'); return; }

    setSaving(true);
    try {
      if (isEdit) {
        await api.updateCustomAgent(agent.id, { name, description, skills, system_prompt: systemPrompt });
      } else {
        await api.createCustomAgent({ name, description, skills, system_prompt: systemPrompt });
      }
      onSave();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">{isEdit ? 'Edit Agent' : 'Create Custom Agent'}</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-300"
        >
          Cancel
        </button>
      </div>

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. SQL Optimizer"
          className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          disabled={isEdit}
        />
        {isEdit && <p className="text-xs text-gray-600 mt-1">Name cannot be changed (determines agent ID)</p>}
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">Description</label>
        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What this agent specializes in"
          className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Skills */}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-2">Skills</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {COMMON_SKILLS.map(skill => (
            <button
              key={skill}
              type="button"
              onClick={() => toggleSkill(skill)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                skills.includes(skill)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {skill}
            </button>
          ))}
        </div>
        {/* Custom skill tags not in COMMON_SKILLS */}
        {skills.filter(s => !COMMON_SKILLS.includes(s)).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {skills.filter(s => !COMMON_SKILLS.includes(s)).map(skill => (
              <button
                key={skill}
                type="button"
                onClick={() => toggleSkill(skill)}
                className="px-2.5 py-1 rounded text-xs font-medium bg-purple-700 text-white hover:bg-purple-600 transition-colors"
              >
                {skill} &times;
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={customSkill}
            onChange={e => setCustomSkill(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomSkill(); } }}
            placeholder="Add custom skill..."
            className="px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={addCustomSkill}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      {/* System Prompt */}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">
          System Prompt
          <span className="text-gray-600 font-normal ml-2">
            (Markdown — this becomes the agent's instructions)
          </span>
        </label>
        <textarea
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          placeholder={"# Agent Name\n\nYou are a specialist in...\n\n## Rules\n- Always...\n- Never..."}
          rows={16}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono text-sm leading-relaxed resize-y"
        />
        <p className="text-xs text-gray-600 mt-1">{systemPrompt.length} characters</p>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving || !name.trim() || !systemPrompt.trim()}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
        >
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Agent'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
