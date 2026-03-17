import { upsertAgent } from './db.js';
import { registerA2AAgent } from './orchestrator.js';

/**
 * Seed agents into the registry and register A2A endpoints.
 */
export function seedDefaultAgents(): void {
  // Claude Code — direct dispatch fallback (no A2A endpoint)
  upsertAgent(
    'claude-code',
    'Claude Code',
    'General-purpose coding and task execution via Claude Code CLI',
    ['coding', 'general', 'ops', 'content'],
    'stock'
  );

  // Research Agent — A2A enabled, Soundwave-based
  upsertAgent(
    'research',
    'Research Agent',
    'Deep web research, database analysis, and structured reporting',
    ['research', 'analysis', 'reporting', 'web-search'],
    'named'
  );
  registerA2AAgent('research', 'http://localhost:3143');
}
