import path from 'path';
import { fileURLToPath } from 'url';
import { startAgentServer } from '../runtime/server.js';
import type { AgentConfig } from '../runtime/agent-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: AgentConfig = {
  id: 'kup',
  name: 'Kup',
  description: 'Engineering grunt for ST Metro — infra maintenance, pattern porting, postmortem drafting.',
  skills: ['engineering', 'infrastructure', 'porting', 'postmortem', 'maintenance'],
  type: 'named',
  port: parseInt(process.env.KUP_AGENT_PORT ?? '3147', 10),
  system_prompt_path: path.resolve(__dirname, 'agent.md'),
  accepts: ['text/plain'],
  produces: ['text/plain', 'text/markdown'],
  timeout_ms: 900_000,
};

startAgentServer(config);
