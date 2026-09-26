/**
 * Subagent exports
 *
 * The orchestrator registers these three specialists in its `agents` map; the
 * keys there become the agent names used in Task invocations.
 */

export { codeQualityAnalyzer } from './code-quality-analyzer.js';
export { testCoverageAnalyzer } from './test-coverage-analyzer.js';
export { refactoringSuggester } from './refactoring-suggester.js';
