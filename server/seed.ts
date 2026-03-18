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
    ['general', 'ops'],
    'stock'
  );

  // Soundwave — Research Agent, A2A enabled
  upsertAgent(
    'research',
    'Soundwave',
    'Deep web research, database analysis, and structured reporting',
    ['research', 'analysis', 'reporting', 'web-search'],
    'named'
  );
  registerA2AAgent('research', 'http://localhost:3143');

  // Ravage — Coding Agent, A2A enabled
  upsertAgent(
    'coding',
    'Ravage',
    'Software engineering — write, modify, debug, refactor, and review code',
    ['coding', 'debugging', 'refactoring', 'testing', 'git'],
    'named'
  );
  registerA2AAgent('coding', 'http://localhost:3144');

  // Content Agent — A2A enabled, writing specialist
  upsertAgent(
    'content',
    'Content Agent',
    'Writing and content — blog posts, documentation, social media, email drafts',
    ['content', 'writing', 'documentation', 'social-media', 'editing'],
    'named'
  );
  registerA2AAgent('content', 'http://localhost:3145');
}
