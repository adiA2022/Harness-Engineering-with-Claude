import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/test-coverage-analyzer.prompt.js';

/**
 * Test Coverage Analyzer subagent.
 *
 * Locates a source file's companion tests, identifies untested functions,
 * branches, and edge cases, and proposes concrete test cases with assertions.
 * Returns findings shaped by TestCoverageResultSchema.
 *
 * Tools: Glob/Grep are essential here — the agent discovers test files by
 * pattern before it can judge coverage. Skill gives it access to language
 * idiom guidance for writing correct async tests.
 */
export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Evaluates test completeness for a source file. Use this agent to find functions, ' +
    'classes, branches, and edge cases that lack test coverage, estimate a coverage ' +
    'percentage without running tests, and produce specific, assertion-bearing test ' +
    'suggestions prioritized by risk.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  model: 'inherit',
  tools: ['Read', 'Grep', 'Glob', 'Skill']
};
