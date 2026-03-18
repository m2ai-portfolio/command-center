import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { upsertAgent } from './db.js';

// ── Types ───────────────────────────────────────────────────────────

export interface StockAgentDef {
  /** Derived from frontmatter name or filename */
  id: string;
  /** Human-readable name from frontmatter */
  name: string;
  /** Description from frontmatter */
  description: string;
  /** Category/folder the agent came from */
  category: string;
  /** Source repo: 'agents' or 'agency-agents' */
  source: string;
  /** Path to the markdown file on disk */
  file_path: string;
  /** Skills derived from category + keywords */
  skills: string[];
}

interface AgentFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  color?: string;
  emoji?: string;
  vibe?: string;
}

// ── Config ──────────────────────────────────────────────────────────

const STOCK_DIR = path.resolve(process.cwd(), 'store', 'stock-repos');

const REPOS = [
  {
    name: 'agents',
    url: 'https://github.com/MatthewSnow2/agents.git',
    dir: path.join(STOCK_DIR, 'agents'),
  },
  {
    name: 'agency-agents',
    url: 'https://github.com/MatthewSnow2/agency-agents.git',
    dir: path.join(STOCK_DIR, 'agency-agents'),
  },
];

// ── Repo Management ─────────────────────────────────────────────────

/** Clone or pull the stock agent repos. */
export function syncStockRepos(): { cloned: number; pulled: number } {
  fs.mkdirSync(STOCK_DIR, { recursive: true });

  let cloned = 0;
  let pulled = 0;

  for (const repo of REPOS) {
    if (fs.existsSync(path.join(repo.dir, '.git'))) {
      try {
        execSync('git pull --ff-only', { cwd: repo.dir, stdio: 'pipe', timeout: 30_000 });
        pulled++;
      } catch {
        console.warn(`[stock-loader] Failed to pull ${repo.name}, using existing`);
      }
    } else {
      try {
        execSync(`git clone --depth 1 ${repo.url} ${repo.dir}`, { stdio: 'pipe', timeout: 60_000 });
        cloned++;
      } catch (err) {
        console.error(`[stock-loader] Failed to clone ${repo.name}:`, err);
      }
    }
  }

  return { cloned, pulled };
}

// ── Frontmatter Parser ──────────────────────────────────────────────

function parseFrontmatter(content: string): { frontmatter: AgentFrontmatter; body: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: content };
  }

  const fmBlock = fmMatch[1];
  const body = fmMatch[2];
  const frontmatter: AgentFrontmatter = {};

  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    (frontmatter as Record<string, string>)[key] = value;
  }

  return { frontmatter, body };
}

// ── Agent Discovery ─────────────────────────────────────────────────

/** Scan a repo for agent markdown files and return parsed definitions. */
function scanRepo(repoName: string, repoDir: string): StockAgentDef[] {
  if (!fs.existsSync(repoDir)) return [];

  const agents: StockAgentDef[] = [];

  if (repoName === 'agents') {
    // Structure: plugins/<category>/agents/*.md
    const pluginsDir = path.join(repoDir, 'plugins');
    if (!fs.existsSync(pluginsDir)) return [];

    for (const category of fs.readdirSync(pluginsDir)) {
      const agentsDir = path.join(pluginsDir, category, 'agents');
      if (!fs.existsSync(agentsDir) || !fs.statSync(agentsDir).isDirectory()) continue;

      for (const file of fs.readdirSync(agentsDir)) {
        if (!file.endsWith('.md')) continue;
        const filePath = path.join(agentsDir, file);
        const agent = parseAgentFile(filePath, category, repoName);
        if (agent) agents.push(agent);
      }
    }
  } else if (repoName === 'agency-agents') {
    // Structure: <category>/*.md (top-level directories)
    for (const category of fs.readdirSync(repoDir)) {
      const catDir = path.join(repoDir, category);
      if (!fs.statSync(catDir).isDirectory()) continue;
      if (category.startsWith('.') || category === 'node_modules' || category === 'scripts' || category === 'examples') continue;

      for (const file of fs.readdirSync(catDir)) {
        if (!file.endsWith('.md')) continue;
        const filePath = path.join(catDir, file);
        const agent = parseAgentFile(filePath, category, repoName);
        if (agent) agents.push(agent);
      }
    }
  }

  return agents;
}

function parseAgentFile(filePath: string, category: string, source: string): StockAgentDef | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter } = parseFrontmatter(content);

    if (!frontmatter.name && !frontmatter.description) return null;

    const filename = path.basename(filePath, '.md');
    const id = `stock-${source}-${slugify(frontmatter.name || filename)}`;
    const name = frontmatter.name || titleCase(filename);
    const description = frontmatter.description || `Stock agent from ${source}/${category}`;

    // Derive skills from category
    const skills = deriveSkills(category, description);

    return {
      id,
      name,
      description,
      category,
      source,
      file_path: filePath,
      skills,
    };
  } catch {
    return null;
  }
}

// ── Skill Derivation ────────────────────────────────────────────────

const CATEGORY_SKILL_MAP: Record<string, string[]> = {
  // agents repo categories
  'api-scaffolding': ['coding', 'api'],
  'api-testing-observability': ['testing', 'ops'],
  'backend-development': ['coding', 'backend'],
  'backend-api-security': ['coding', 'security'],
  'blockchain-web3': ['coding', 'blockchain'],
  'business-analytics': ['analysis', 'reporting'],
  'cicd-automation': ['ops', 'devops'],
  'cloud-infrastructure': ['ops', 'cloud'],
  'codebase-cleanup': ['coding', 'refactoring'],
  'code-documentation': ['coding', 'documentation'],
  'code-refactoring': ['coding', 'refactoring'],
  'comprehensive-review': ['coding', 'review'],
  'content-marketing': ['content', 'marketing'],
  'conductor': ['orchestration'],
  // agency-agents repo categories
  'design': ['design', 'ux'],
  'engineering': ['coding', 'engineering'],
  'marketing': ['content', 'marketing'],
  'product': ['product', 'analysis'],
  'project-management': ['project-management', 'ops'],
  'sales': ['sales', 'content'],
  'support': ['support', 'content'],
  'testing': ['testing', 'qa'],
  'strategy': ['analysis', 'strategy'],
  'integrations': ['coding', 'integrations'],
  'game-development': ['coding', 'game-dev'],
  'spatial-computing': ['coding', 'xr'],
  'specialized': ['specialist'],
  'paid-media': ['marketing', 'analytics'],
};

function deriveSkills(category: string, description: string): string[] {
  const skills = CATEGORY_SKILL_MAP[category] ?? [category];

  // Add content skill if description mentions writing-related terms
  const lower = description.toLowerCase();
  if (/\b(writ|draft|copy|blog|article|content)\b/.test(lower) && !skills.includes('content')) {
    skills.push('content');
  }
  if (/\b(code|develop|build|implement|debug)\b/.test(lower) && !skills.includes('coding')) {
    skills.push('coding');
  }
  if (/\b(research|analyz|investigat)\b/.test(lower) && !skills.includes('research')) {
    skills.push('research');
  }

  return skills;
}

// ── Registration ────────────────────────────────────────────────────

/** Scan all repos and return available stock agents. */
export function listStockAgents(): StockAgentDef[] {
  const all: StockAgentDef[] = [];
  for (const repo of REPOS) {
    all.push(...scanRepo(repo.name, repo.dir));
  }
  return all;
}

/** Load a specific stock agent into the DB registry (does not start a server). */
export function loadStockAgent(agentId: string): StockAgentDef | null {
  const all = listStockAgents();
  const agent = all.find(a => a.id === agentId);
  if (!agent) return null;

  upsertAgent(
    agent.id,
    agent.name,
    agent.description,
    agent.skills,
    'stock'
  );

  return agent;
}

/** Load all stock agents from a category into the DB registry. */
export function loadStockCategory(category: string): StockAgentDef[] {
  const all = listStockAgents();
  const matching = all.filter(a => a.category === category);

  for (const agent of matching) {
    upsertAgent(
      agent.id,
      agent.name,
      agent.description,
      agent.skills,
      'stock'
    );
  }

  return matching;
}

/** Get the full markdown system prompt for a stock agent. */
export function getStockAgentPrompt(agentId: string): string | null {
  const all = listStockAgents();
  const agent = all.find(a => a.id === agentId);
  if (!agent) return null;

  try {
    return fs.readFileSync(agent.file_path, 'utf-8');
  } catch {
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function titleCase(str: string): string {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
