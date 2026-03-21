import { spawn } from 'child_process';
import type { QualityScores, JudgeVerdict } from '../shared/types.js';
import { computeCompositeScore } from '../shared/types.js';

/**
 * Judge (Phase 5.3 + 5.4) — Two-layer mission quality evaluation.
 *
 * Layer 1: Algorithmic pre-judge — free, instant, catches obvious failures.
 * Layer 2: LLM judge — Sonnet evaluates quality on 3 dimensions.
 *
 * The composite score is a weighted average per task type (see DIMENSION_WEIGHTS).
 */

// ── Layer 1: Algorithmic Pre-Judge ──────────────────────────────

const ERROR_PATTERNS = [
  /\bfatal error\b/i,
  /\bunhandled exception\b/i,
  /\bstack trace\b/i,
  /\bsegmentation fault\b/i,
  /\bout of memory\b/i,
  /\bpermission denied\b/i,
  /\bcommand not found\b/i,
  /\bmodule not found\b/i,
  /\bconnection refused\b/i,
  /\btimeout exceeded\b/i,
  /\bno such file or directory\b/i,
  /^error:/im,
];

interface AlgorithmicResult {
  passed: boolean;
  failReason: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export function algorithmicPreJudge(
  goal: string,
  result: string,
  status: string,
  durationMs: number,
  timeoutMs: number,
): AlgorithmicResult {
  // Hard fail: mission already failed
  if (status === 'failed') {
    return { passed: false, failReason: 'Mission execution failed', confidence: 'high' };
  }

  // Hard fail: empty or trivial output
  if (!result || result.trim().length < 10) {
    return { passed: false, failReason: 'Output is empty or trivially short', confidence: 'high' };
  }

  // Hard fail: output is just "(no output)"
  if (result.trim() === '(no output)') {
    return { passed: false, failReason: 'Agent produced no output', confidence: 'high' };
  }

  // Soft fail: output is dominated by error patterns
  const errorMatches = ERROR_PATTERNS.filter(p => p.test(result));
  if (errorMatches.length >= 3) {
    return { passed: false, failReason: `Output contains ${errorMatches.length} error patterns`, confidence: 'medium' };
  }

  // Soft fail: timed out (used >90% of timeout)
  if (durationMs > timeoutMs * 0.9) {
    return { passed: false, failReason: 'Mission consumed >90% of timeout budget', confidence: 'medium' };
  }

  // Heuristic pass: output length is reasonable relative to goal
  const goalWords = goal.split(/\s+/).length;
  const resultWords = result.split(/\s+/).length;
  if (resultWords < goalWords * 0.1 && resultWords < 20) {
    return { passed: false, failReason: 'Output is suspiciously short relative to goal complexity', confidence: 'low' };
  }

  return { passed: true, failReason: null, confidence: 'low' };
}

// ── Layer 2: LLM Judge ──────────────────────────────────────────

const JUDGE_SYSTEM_PROMPT = `You are a quality judge for an AI agent orchestration system. You evaluate mission outputs on three dimensions.

## Scoring Dimensions (each 0.0 to 1.0)

1. **correctness**: Did the output achieve what was asked? Does it work? Are facts accurate?
   - 1.0 = Fully correct, works as intended
   - 0.5 = Partially correct, some issues
   - 0.0 = Wrong, broken, or factually incorrect

2. **completeness**: Were all parts of the request addressed? Nothing missing?
   - 1.0 = Every aspect covered
   - 0.5 = Main request covered, some parts missing
   - 0.0 = Major parts missing or only superficially addressed

3. **relevance**: Is the output on-topic and well-targeted for the goal?
   - 1.0 = Precisely targeted, no fluff
   - 0.5 = Mostly relevant but includes unnecessary content or misses the real intent
   - 0.0 = Off-topic or addresses the wrong problem

## Rules
- Be honest and calibrated. A "good enough" output is ~0.7, not 1.0
- Don't inflate scores to be nice. Agents improve through accurate feedback
- If the output is clearly a failure (errors, empty, wrong), score accordingly
- Consider the task type when judging (coding needs to be correct above all; research needs to be complete; content needs to be relevant)

## Output Format
Return ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON.

{"correctness": 0.0, "completeness": 0.0, "relevance": 0.0, "reasoning": "One sentence explaining the scores."}`;

export async function llmJudge(
  goal: string,
  result: string,
  taskType: string,
): Promise<{ scores: QualityScores; reasoning: string }> {
  const prompt = `## Mission Goal
${goal}

## Task Type
${taskType}

## Agent Output
${result.slice(0, 8000)}

Score this output on correctness, completeness, and relevance.`;

  const raw = await callJudge(prompt);

  try {
    // Strip code fences if present
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');

    const parsed = JSON.parse(cleaned);
    const scores: QualityScores = {
      correctness: clamp(parsed.correctness ?? 0),
      completeness: clamp(parsed.completeness ?? 0),
      relevance: clamp(parsed.relevance ?? 0),
    };
    return { scores, reasoning: parsed.reasoning ?? '' };
  } catch (err) {
    console.error('LLM Judge parse error:', err, 'Raw:', raw.slice(0, 200));
    // Return neutral scores on parse failure
    return {
      scores: { correctness: 0.5, completeness: 0.5, relevance: 0.5 },
      reasoning: 'Judge output could not be parsed — defaulting to neutral scores.',
    };
  }
}

// ── Combined Judge ──────────────────────────────────────────────

export async function judgeMission(
  goal: string,
  result: string,
  taskType: string,
  status: string,
  durationMs: number,
  timeoutMs: number = 900_000,
): Promise<JudgeVerdict> {
  const now = Math.floor(Date.now() / 1000);

  // Layer 1: Algorithmic pre-judge
  const algoResult = algorithmicPreJudge(goal, result, status, durationMs, timeoutMs);

  // If algorithmic judge is confident it failed, skip LLM
  if (!algoResult.passed && algoResult.confidence === 'high') {
    const scores: QualityScores = { correctness: 0, completeness: 0, relevance: 0 };
    return {
      passed: false,
      quality_scores: scores,
      composite_score: 0,
      reasoning: `Algorithmic pre-judge: ${algoResult.failReason}`,
      evaluated_at: now,
      method: 'algorithmic',
    };
  }

  // Layer 2: LLM judge for everything else
  try {
    const { scores, reasoning } = await llmJudge(goal, result, taskType);
    const composite = computeCompositeScore(scores, taskType);

    // Combine algorithmic and LLM verdicts
    const passed = algoResult.passed
      ? composite >= 0.4  // LLM determines pass/fail threshold
      : false;            // Algorithmic said fail (medium confidence), LLM scores for data

    const method = algoResult.passed ? 'llm' : 'both';
    const fullReasoning = algoResult.passed
      ? reasoning
      : `Algorithmic: ${algoResult.failReason}. LLM: ${reasoning}`;

    return {
      passed,
      quality_scores: scores,
      composite_score: composite,
      reasoning: fullReasoning,
      evaluated_at: now,
      method,
    };
  } catch (err) {
    // LLM failed — fall back to algorithmic result only
    console.error('LLM Judge failed:', err);
    const scores: QualityScores = algoResult.passed
      ? { correctness: 0.5, completeness: 0.5, relevance: 0.5 }
      : { correctness: 0, completeness: 0, relevance: 0 };
    const composite = computeCompositeScore(scores, taskType);

    return {
      passed: algoResult.passed,
      quality_scores: scores,
      composite_score: composite,
      reasoning: `LLM judge unavailable. Algorithmic: ${algoResult.failReason ?? 'passed basic checks'}`,
      evaluated_at: now,
      method: 'algorithmic',
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function clamp(n: number): number {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

function callJudge(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--print', prompt,
      '--output-format', 'text',
      '--append-system-prompt', JUDGE_SYSTEM_PROMPT,
      '--max-turns', '1',
      '--model', 'sonnet',
    ];

    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const child = spawn('claude', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Judge exited with code ${code}: ${stderr.trim()}`));
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn judge: ${err.message}`));
    });
  });
}
