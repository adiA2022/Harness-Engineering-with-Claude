import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/refactoring-suggester.prompt.js';

/**
 * Refactoring Suggester subagent.
 *
 * Proposes structural improvements to working code: modernization to current
 * language features, extract-function/class opportunities, design-pattern
 * upgrades, and dead-code removal. Returns findings shaped by
 * RefactoringSuggestionSchema with before/after snippets.
 *
 * Tools: Read/Grep/Glob for inspecting the file and its neighbours (duplication
 * often spans files), plus Skill for language-idiom expertise.
 */
export const refactoringSuggester: AgentDefinition = {
  description:
    'Identifies refactoring opportunities in working code: modernizing to current language ' +
    'features, extracting overlong functions, replacing conditional chains with patterns, ' +
    'simplifying redundant logic, and removing dead code. Use this agent for structural and ' +
    'readability improvements rather than bug or security findings. Returns before/after ' +
    'code snippets with impact ratings.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  model: 'inherit',
  tools: ['Read', 'Grep', 'Glob', 'Skill']
};
