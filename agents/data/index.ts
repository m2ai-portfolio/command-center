import path from 'path';
import { fileURLToPath } from 'url';
import { startAgentServer } from '../runtime/server.js';
import type { AgentConfig } from '../runtime/agent-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: AgentConfig = {
  id: 'data',
  name: 'Data',
  description: 'Chief of Staff for ST Metro — dispatch layer, open-item queue, weekly digest.',
  skills: ['dispatch', 'digest', 'open-items', 'cleanup', 'cos'],
  type: 'named',
  port: parseInt(process.env.DATA_AGENT_PORT ?? '3146', 10),
  system_prompt_path: path.resolve(__dirname, 'agent.md'),
  accepts: ['text/plain'],
  produces: ['text/plain', 'text/markdown'],
  timeout_ms: 600_000,
};

startAgentServer(config);
