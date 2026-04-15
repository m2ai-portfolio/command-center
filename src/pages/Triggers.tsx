import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

type ConditionType = 'mission_failed' | 'schedule_missed' | 'agent_offline';
type ActionType = 'dispatch_mission_task' | 'notify_log_file';

interface Trigger {
  id: string;
  name: string;
  enabled: boolean;
  condition_type: ConditionType;
  condition_config: Record<string, unknown>;
  action_type: ActionType;
  action_config: Record<string, unknown>;
  cooldown_seconds: number;
  last_fired_at: number | null;
  fire_count: number;
  created_at: number;
}

interface TriggerFire {
  id: number;
  trigger_id: string;
  fired_at: number;
  event_payload: Record<string, unknown>;
  action_result: string | null;
}

interface Agent {
  id: string;
  name: string;
}

const CONDITION_LABELS: Record<ConditionType, string> = {
  mission_failed: 'Mission failed',
  schedule_missed: 'Schedule missed',
  agent_offline: 'Agent offline',
};

const ACTION_LABELS: Record<ActionType, string> = {
  dispatch_mission_task: 'Dispatch mission task',
  notify_log_file: 'Append to log file',
};

function formatTime(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function Triggers() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fires, setFires] = useState<Record<string, TriggerFire[]>>({});
  const [error, setError] = useState<string | null>(null);

  // Form state (3-step wizard)
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [conditionType, setConditionType] = useState<ConditionType>('mission_failed');
  const [conditionAgentId, setConditionAgentId] = useState('');
  const [conditionMinDuration, setConditionMinDuration] = useState(60);
  const [actionType, setActionType] = useState<ActionType>('notify_log_file');
  const [logPath, setLogPath] = useState('/tmp/cmd-triggers.log');
  const [logFormat, setLogFormat] = useState<'json' | 'text'>('json');
  const [dispatchAgent, setDispatchAgent] = useState('');
  const [dispatchTitle, setDispatchTitle] = useState('');
  const [dispatchPrompt, setDispatchPrompt] = useState('');
  const [cooldown, setCooldown] = useState(300);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.listTriggers().then(data => setTriggers(data.triggers as Trigger[])).catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
    api.listAgents().then(data => setAgents(data.agents as Agent[])).catch(() => {});
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const resetForm = () => {
    setStep(1);
    setName('');
    setConditionType('mission_failed');
    setConditionAgentId('');
    setConditionMinDuration(60);
    setActionType('notify_log_file');
    setLogPath('/tmp/cmd-triggers.log');
    setLogFormat('json');
    setDispatchAgent('');
    setDispatchTitle('');
    setDispatchPrompt('');
    setCooldown(300);
    setCreating(false);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const condition_config: Record<string, unknown> = {};
      if (conditionType === 'mission_failed' && conditionAgentId) {
        condition_config.agent_id = conditionAgentId;
      }
      if (conditionType === 'agent_offline') {
        if (conditionAgentId) condition_config.agent_id = conditionAgentId;
        condition_config.min_duration_seconds = conditionMinDuration;
      }

      let action_config: Record<string, unknown>;
      if (actionType === 'notify_log_file') {
        if (!logPath.trim()) throw new Error('Log path is required');
        action_config = { path: logPath.trim(), format: logFormat };
      } else {
        if (!dispatchAgent) throw new Error('Agent is required for dispatch');
        if (!dispatchPrompt.trim()) throw new Error('Prompt is required for dispatch');
        action_config = {
          agent: dispatchAgent,
          title: dispatchTitle.trim() || `Triggered: ${name.trim()}`,
          prompt: dispatchPrompt.trim(),
        };
      }

      await api.createTrigger({
        name: name.trim(),
        condition_type: conditionType,
        condition_config,
        action_type: actionType,
        action_config,
        cooldown_seconds: cooldown,
      });
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (t: Trigger) => {
    try {
      await api.updateTrigger(t.id, { enabled: !t.enabled });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this trigger? Fire history will also be deleted.')) return;
    try {
      await api.deleteTrigger(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    try {
      const data = await api.listTriggerFires(id, 20);
      setFires(prev => ({ ...prev, [id]: data.fires as TriggerFire[] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const describeCondition = (t: Trigger): string => {
    const base = CONDITION_LABELS[t.condition_type];
    const cfg = t.condition_config;
    const bits: string[] = [];
    if (cfg.agent_id) bits.push(`agent=${cfg.agent_id as string}`);
    if (cfg.min_duration_seconds) bits.push(`min ${cfg.min_duration_seconds as number}s`);
    return bits.length ? `${base} (${bits.join(', ')})` : base;
  };

  const describeAction = (t: Trigger): string => {
    const base = ACTION_LABELS[t.action_type];
    const cfg = t.action_config;
    if (t.action_type === 'notify_log_file' && cfg.path) return `${base} → ${cfg.path as string}`;
    if (t.action_type === 'dispatch_mission_task' && cfg.agent) return `${base} → ${cfg.agent as string}`;
    return base;
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Triggers</h1>
          <p className="text-sm text-gray-500 mt-1">Fire an action when a condition is met.</p>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
          >
            + New Trigger
          </button>
        )}
      </div>

      {error && <p className="mb-4 text-red-400 text-sm">{error}</p>}

      {creating && (
        <div className="mb-6 p-4 bg-gray-900 border border-gray-700 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">New Trigger — Step {step} of 3</h2>
            <button onClick={resetForm} className="text-sm text-gray-500 hover:text-gray-300">Cancel</button>
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Alert on Kup failures"
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Condition</label>
                <select
                  value={conditionType}
                  onChange={e => setConditionType(e.target.value as ConditionType)}
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="mission_failed">Mission failed</option>
                  <option value="schedule_missed">Schedule missed</option>
                  <option value="agent_offline">Agent offline</option>
                </select>
              </div>

              {(conditionType === 'mission_failed' || conditionType === 'agent_offline') && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Filter by agent {conditionType === 'mission_failed' ? '(optional)' : '(optional — leave blank for any)'}
                  </label>
                  <select
                    value={conditionAgentId}
                    onChange={e => setConditionAgentId(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Any agent</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                  </select>
                </div>
              )}

              {conditionType === 'agent_offline' && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Minimum downtime (seconds)</label>
                  <input
                    type="number"
                    min={0}
                    value={conditionMinDuration}
                    onChange={e => setConditionMinDuration(parseInt(e.target.value, 10) || 0)}
                    className="w-32 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">Only fire after agent has been down this long.</p>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setStep(2)}
                  disabled={!name.trim()}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Action</label>
                <select
                  value={actionType}
                  onChange={e => setActionType(e.target.value as ActionType)}
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="notify_log_file">Append to log file</option>
                  <option value="dispatch_mission_task">Dispatch mission task</option>
                </select>
              </div>

              {actionType === 'notify_log_file' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Log file path</label>
                    <input
                      type="text"
                      value={logPath}
                      onChange={e => setLogPath(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 font-mono text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Format</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={logFormat === 'json'} onChange={() => setLogFormat('json')} className="accent-blue-500" />
                        <span className="text-sm text-gray-300">JSON</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={logFormat === 'text'} onChange={() => setLogFormat('text')} className="accent-blue-500" />
                        <span className="text-sm text-gray-300">Text</span>
                      </label>
                    </div>
                  </div>
                </>
              )}

              {actionType === 'dispatch_mission_task' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Agent</label>
                    <select
                      value={dispatchAgent}
                      onChange={e => setDispatchAgent(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Select agent…</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Title (optional)</label>
                    <input
                      type="text"
                      value={dispatchTitle}
                      onChange={e => setDispatchTitle(e.target.value)}
                      placeholder={`Triggered: ${name || '<name>'}`}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Prompt</label>
                    <textarea
                      value={dispatchPrompt}
                      onChange={e => setDispatchPrompt(e.target.value)}
                      rows={4}
                      placeholder="What should the agent do when this trigger fires? Event payload is appended automatically."
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </>
              )}

              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">← Back</button>
                <button
                  onClick={() => setStep(3)}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Cooldown (seconds)</label>
                <input
                  type="number"
                  min={0}
                  value={cooldown}
                  onChange={e => setCooldown(parseInt(e.target.value, 10) || 0)}
                  className="w-32 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Minimum seconds between fires. Prevents spam.</p>
              </div>

              <div className="p-3 bg-gray-800/50 border border-gray-700 rounded text-sm space-y-1">
                <div><span className="text-gray-500">Name:</span> <span className="text-gray-200">{name}</span></div>
                <div><span className="text-gray-500">When:</span> <span className="text-gray-200">{CONDITION_LABELS[conditionType]}</span>
                  {conditionAgentId && <span className="text-gray-400"> (agent: {conditionAgentId})</span>}
                  {conditionType === 'agent_offline' && <span className="text-gray-400"> (≥ {conditionMinDuration}s)</span>}
                </div>
                <div><span className="text-gray-500">Do:</span> <span className="text-gray-200">{ACTION_LABELS[actionType]}</span>
                  {actionType === 'notify_log_file' && <span className="text-gray-400"> ({logPath})</span>}
                  {actionType === 'dispatch_mission_task' && <span className="text-gray-400"> ({dispatchAgent || '<no agent>'})</span>}
                </div>
                <div><span className="text-gray-500">Cooldown:</span> <span className="text-gray-200">{cooldown}s</span></div>
              </div>

              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(2)} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">← Back</button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="px-6 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                >
                  {saving ? 'Creating…' : 'Create Trigger'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {triggers.length === 0 && !creating ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No triggers yet</p>
          <p className="text-sm">Create a trigger to react to failures, missed schedules, or offline agents.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {triggers.map(t => (
            <div
              key={t.id}
              className={`bg-gray-900 border rounded-lg transition-colors ${
                t.enabled ? 'border-gray-800' : 'border-gray-800/50 opacity-60'
              }`}
            >
              <div className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${t.enabled ? 'bg-green-500' : 'bg-gray-600'}`} />
                    <span className="text-gray-100 font-medium">{t.name}</span>
                    <span className="text-xs text-gray-500">· fired {t.fire_count}×</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>When: <span className="text-gray-300">{describeCondition(t)}</span></span>
                    <span>Do: <span className="text-gray-300">{describeAction(t)}</span></span>
                    <span>Cooldown: <span className="text-gray-400">{t.cooldown_seconds}s</span></span>
                    {t.last_fired_at && <span>Last: <span className="text-gray-400">{formatTime(t.last_fired_at)}</span></span>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleExpand(t.id)}
                    className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded transition-colors"
                  >
                    {expandedId === t.id ? 'Hide' : 'History'}
                  </button>
                  <button
                    onClick={() => handleToggle(t)}
                    className={`px-3 py-1.5 text-sm rounded transition-colors ${
                      t.enabled
                        ? 'bg-gray-800 hover:bg-yellow-900 text-gray-400 hover:text-yellow-300'
                        : 'bg-gray-800 hover:bg-green-900 text-gray-400 hover:text-green-300'
                    }`}
                  >
                    {t.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-red-900 text-gray-400 hover:text-red-300 rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {expandedId === t.id && (
                <div className="border-t border-gray-800 p-4 bg-gray-950/50">
                  <p className="text-xs text-gray-500 mb-2">Recent fires (last 20):</p>
                  {(fires[t.id] ?? []).length === 0 ? (
                    <p className="text-sm text-gray-600">No fires yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {fires[t.id].map(f => (
                        <div key={f.id} className="text-xs bg-gray-900 border border-gray-800 rounded p-2">
                          <div className="flex justify-between mb-1">
                            <span className="text-gray-400">{formatTime(f.fired_at)}</span>
                            <span className="text-gray-500 truncate ml-2">{f.action_result ?? '(no result)'}</span>
                          </div>
                          <pre className="text-gray-500 overflow-x-auto">{JSON.stringify(f.event_payload, null, 2)}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
