import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/code-quality-analyzer.prompt.js';

/**
 * Code Quality Analyzer subagent.
 *
 * Reviews changed files for security vulnerabilities, performance problems, and
 * maintainability risks, returning findings shaped by CodeQualityResultSchema.
 *
 * Tools: file inspection (Read/Grep/Glob) plus the ESLint MCP tools for static
 * analysis, and the Skill tool so the agent can pull in specialized guidance
 * from .claude/skills (e.g. javascript-best-practices).
 */
export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Analyzes source files for security vulnerabilities, performance bottlenecks, and ' +
    'maintainability problems. Use this agent when a changed file needs a quality review ' +
    'covering injection risks, unsafe data handling, inefficient algorithms, missing error ' +
    'handling, or best-practice violations. Returns line-referenced issues with severities ' +
    'and a 0-100 quality score.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  model: 'inherit',
  tools: [
    'Read',
    'Grep',
    'Glob',
    'Skill',
    'mcp__eslint__lint-files'
  ]
};
