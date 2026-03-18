import fs from 'fs';
import path from 'path';
import { upsertAgent, getDb } from './db.js';

// ── Types ───────────────────────────────────────────────────────────

export interface CustomAgentDef {
  id: string;
  name: string;
  description: string;
  skills: string[];
  system_prompt: string;
  created_at: number;
  updated_at: number;
}

interface CustomAgentInput {
  name: string;
  description: string;
  skills: string[];
  system_prompt: string;
}

// ── Config ──────────────────────────────────────────────────────────

function findProjectRoot(): string {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const CUSTOM_DIR = path.resolve(findProjectRoot(), 'store', 'custom-agents');

// ── Helpers ─────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function agentFilePath(id: string): string {
  return path.join(CUSTOM_DIR, `${id}.md`);
}

function buildMarkdown(agent: CustomAgentInput): string {
  return [
    '---',
    `name: "${agent.name}"`,
    `description: "${agent.description}"`,
    `skills: ${JSON.stringify(agent.skills)}`,
    '---',
    '',
    agent.system_prompt,
  ].join('\n');
}

function parseMarkdown(content: string): { name: string; description: string; skills: string[]; system_prompt: string } | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  const fmBlock = fmMatch[1];
  const body = fmMatch[2].trim();
  const fields: Record<string, string> = {};

  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  let skills: string[] = [];
  if (fields.skills) {
    try { skills = JSON.parse(fields.skills); } catch { skills = []; }
  }

  return {
    name: fields.name || '',
    description: fields.description || '',
    skills,
    system_prompt: body,
  };
}

// ── CRUD ────────────────────────────────────────────────────────────

export function listCustomAgents(): CustomAgentDef[] {
  fs.mkdirSync(CUSTOM_DIR, { recursive: true });

  const files = fs.readdirSync(CUSTOM_DIR).filter(f => f.endsWith('.md'));
  const agents: CustomAgentDef[] = [];

  for (const file of files) {
    const id = path.basename(file, '.md');
    const filePath = path.join(CUSTOM_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseMarkdown(content);
    if (!parsed) continue;

    const stat = fs.statSync(filePath);
    agents.push({
      id,
      name: parsed.name,
      description: parsed.description,
      skills: parsed.skills,
      system_prompt: parsed.system_prompt,
      created_at: Math.floor(stat.birthtimeMs / 1000),
      updated_at: Math.floor(stat.mtimeMs / 1000),
    });
  }

  return agents.sort((a, b) => b.updated_at - a.updated_at);
}

export function getCustomAgent(id: string): CustomAgentDef | null {
  const filePath = agentFilePath(id);
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseMarkdown(content);
  if (!parsed) return null;

  const stat = fs.statSync(filePath);
  return {
    id,
    name: parsed.name,
    description: parsed.description,
    skills: parsed.skills,
    system_prompt: parsed.system_prompt,
    created_at: Math.floor(stat.birthtimeMs / 1000),
    updated_at: Math.floor(stat.mtimeMs / 1000),
  };
}

export function createCustomAgent(input: CustomAgentInput): CustomAgentDef {
  fs.mkdirSync(CUSTOM_DIR, { recursive: true });

  const id = `custom-${slugify(input.name)}`;
  const filePath = agentFilePath(id);

  if (fs.existsSync(filePath)) {
    throw new Error(`Custom agent "${input.name}" already exists`);
  }

  fs.writeFileSync(filePath, buildMarkdown(input), 'utf-8');

  // Register in DB
  upsertAgent(id, input.name, input.description, input.skills, 'custom');

  return getCustomAgent(id)!;
}

export function updateCustomAgent(id: string, input: Partial<CustomAgentInput>): CustomAgentDef {
  const existing = getCustomAgent(id);
  if (!existing) throw new Error(`Custom agent ${id} not found`);

  const updated: CustomAgentInput = {
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    skills: input.skills ?? existing.skills,
    system_prompt: input.system_prompt ?? existing.system_prompt,
  };

  fs.writeFileSync(agentFilePath(id), buildMarkdown(updated), 'utf-8');

  // Update DB registry
  upsertAgent(id, updated.name, updated.description, updated.skills, 'custom');

  return getCustomAgent(id)!;
}

export function deleteCustomAgent(id: string): boolean {
  const filePath = agentFilePath(id);
  if (!fs.existsSync(filePath)) return false;

  fs.unlinkSync(filePath);

  // Remove from DB
  getDb().prepare('DELETE FROM agents WHERE id = ?').run(id);
  return true;
}

/** Get the full system prompt for a custom agent (for executor). */
export function getCustomAgentPrompt(agentId: string): string | null {
  const agent = getCustomAgent(agentId);
  return agent?.system_prompt ?? null;
}
