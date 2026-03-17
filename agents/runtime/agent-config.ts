/**
 * Agent configuration — loaded from a YAML file or passed directly.
 */
export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  skills: string[];
  type: 'named' | 'stock';
  port: number;
  /** Path to the markdown system prompt file */
  system_prompt_path?: string;
  /** Inline system prompt (alternative to file) */
  system_prompt?: string;
  /** What input formats this agent accepts */
  accepts: string[];
  /** What output formats this agent produces */
  produces: string[];
  /** Task timeout in ms */
  timeout_ms: number;
}

export const DEFAULT_CONFIG: Partial<AgentConfig> = {
  type: 'stock',
  accepts: ['text/plain'],
  produces: ['text/plain'],
  timeout_ms: 600_000, // 10 min
};
