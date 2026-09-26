import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CodeReviewOrchestrator } from '../src/orchestrator';
import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester
} from '../src/agents';
import { mcpServersConfig } from '../src/config/mcp.config';
import { buildOrchestratorPrompt } from '../src/prompts';
import { ReviewReportSchema } from '../src/types/report-types';

/**
 * Tests for CodeReviewOrchestrator and its wiring.
 *
 * The SDK `query` call is mocked so these run offline: we assert on the options
 * the orchestrator passes to the SDK (agents registered, Task allowed, output
 * schema set) and on how it handles the messages the SDK streams back.
 */

const validReport = {
  pullRequest: { owner: 'airaamane', repo: 'simple-todo-app', number: 2 },
  fileReviews: [
    {
      file: 'src/search.js',
      codeQuality: {
        file: 'src/search.js',
        issues: [
          {
            line: 12,
            severity: 'medium' as const,
            category: 'performance' as const,
            description: 'Filter runs over the full list on every keystroke',
            suggestion: 'Debounce the input handler'
          }
        ],
        overallScore: 80,
        summary: 'Reasonable implementation with one performance concern.'
      },
      testCoverage: {
        file: 'src/search.js',
        hasTests: false,
        testFiles: [],
        untestedPaths: [
          {
            type: 'function' as const,
            location: 'searchTodos() (line 5)',
            priority: 'high' as const,
            reasoning: 'Core feature with no tests',
            suggestedTest: "it('matches case-insensitively', () => { ... })"
          }
        ],
        coverageEstimate: 0,
        summary: 'No tests accompany this new feature.'
      },
      refactorings: {
        file: 'src/search.js',
        suggestions: [],
        summary: 'Structure is fine as written.'
      }
    }
  ],
  summary: {
    totalFiles: 1,
    overallScore: 80,
    criticalIssues: 0,
    highPriorityTests: 1,
    refactoringOpportunities: 0
  },
  recommendations: [
    {
      priority: 'high' as const,
      category: 'Testing',
      description: 'Add tests for the new search feature',
      files: ['src/search.js']
    }
  ],
  metadata: {
    analyzedAt: '2026-08-20T22:30:00.000Z',
    duration: 1000,
    agentVersions: { 'code-quality-analyzer': '1.0.0' }
  }
};

/** Build an async iterable of SDK-shaped messages. */
function mockStream(messages: unknown[]): AsyncIterable<any> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message;
    }
  } as AsyncIterable<any>;
}

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => queryMock(...args)
}));

describe('CodeReviewOrchestrator', () => {
  beforeEach(() => {
    queryMock.mockReset();
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Configuration', () => {
    it('initializes with default options', () => {
      const orchestrator = new CodeReviewOrchestrator();
      expect(orchestrator).toBeInstanceOf(CodeReviewOrchestrator);
    });

    it('accepts custom rate limit configuration', () => {
      const orchestrator = new CodeReviewOrchestrator({
        rateLimits: { maxConcurrent: 1, maxRequestsPerMinute: 5 }
      });
      expect(orchestrator).toBeInstanceOf(CodeReviewOrchestrator);
    });

    it('reads the model from the environment rather than hardcoding one', async () => {
      process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'success', structured_output: validReport }])
      );

      await new CodeReviewOrchestrator().reviewPullRequest('airaamane', 'simple-todo-app', 2);

      expect(queryMock.mock.calls[0][0].options.model).toBe('claude-haiku-4-5-20251001');
    });

    it('fails fast when ANTHROPIC_MODEL is absent instead of guessing a model', () => {
      delete process.env.ANTHROPIC_MODEL;
      expect(() => new CodeReviewOrchestrator()).toThrowError(/ANTHROPIC_MODEL is not set/);
    });

    it('registers all three subagents with the SDK', async () => {
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'success', structured_output: validReport }])
      );

      await new CodeReviewOrchestrator().reviewPullRequest('airaamane', 'simple-todo-app', 2);

      const options = queryMock.mock.calls[0][0].options;
      expect(Object.keys(options.agents)).toEqual([
        'code-quality-analyzer',
        'test-coverage-analyzer',
        'refactoring-suggester'
      ]);
    });

    it('allows the Task tool so subagents can be spawned', async () => {
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'success', structured_output: validReport }])
      );

      await new CodeReviewOrchestrator().reviewPullRequest('airaamane', 'simple-todo-app', 2);

      const options = queryMock.mock.calls[0][0].options;
      expect(options.allowedTools).toContain('Task');
      expect(options.allowedTools.some((t: string) => t.startsWith('mcp__github__'))).toBe(true);
    });

    it('configures both MCP servers', async () => {
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'success', structured_output: validReport }])
      );

      await new CodeReviewOrchestrator().reviewPullRequest('airaamane', 'simple-todo-app', 2);

      const options = queryMock.mock.calls[0][0].options;
      expect(options.mcpServers).toHaveProperty('github');
      expect(options.mcpServers).toHaveProperty('eslint');
    });

    it('requests structured output against the ReviewReport JSON schema', async () => {
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'success', structured_output: validReport }])
      );

      await new CodeReviewOrchestrator().reviewPullRequest('airaamane', 'simple-todo-app', 2);

      const options = queryMock.mock.calls[0][0].options;
      expect(options.outputFormat.type).toBe('json_schema');
      expect(options.outputFormat.schema).toHaveProperty('properties');
    });
  });

  describe('reviewPullRequest', () => {
    it('returns a schema-valid ReviewReport', async () => {
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'success', structured_output: validReport }])
      );

      const report = await new CodeReviewOrchestrator().reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        2
      );

      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
      expect(report.pullRequest.number).toBe(2);
      expect(report.fileReviews).toHaveLength(1);
    });

    it('measures and overwrites the report duration', async () => {
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'success', structured_output: validReport }])
      );

      const report = await new CodeReviewOrchestrator().reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        2
      );

      // The model claimed 1000ms; the orchestrator replaces it with real elapsed time.
      expect(report.metadata.duration).not.toBe(1000);
      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it('stamps analyzedAt with the real run time, not the model guess', async () => {
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'success', structured_output: validReport }])
      );

      const before = Date.now();
      const report = await new CodeReviewOrchestrator().reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        2
      );

      // The model claimed 2026-08-20T22:30:00Z; only the measured stamp survives.
      const stamped = Date.parse(report.metadata.analyzedAt);
      expect(stamped).toBeGreaterThanOrEqual(before - 1000);
      expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('recomputes summary counters that disagree with the findings', async () => {
      // The model claims counts that its own fileReviews do not support: the single
      // file review holds 1 issue (medium, not critical), 1 high-priority untested
      // path, and 0 refactorings.
      const inflated = {
        ...validReport,
        summary: {
          totalFiles: 9,
          overallScore: 99,
          criticalIssues: 7,
          highPriorityTests: 42,
          refactoringOpportunities: 5
        }
      };
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'success', structured_output: inflated }])
      );

      const report = await new CodeReviewOrchestrator().reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        2
      );

      expect(report.summary.totalFiles).toBe(1);
      expect(report.summary.criticalIssues).toBe(0);
      expect(report.summary.highPriorityTests).toBe(1);
      expect(report.summary.refactoringOpportunities).toBe(0);
      // overallScore is the mean of per-file code-quality scores (a single 80 here).
      expect(report.summary.overallScore).toBe(80);
    });

    it('leaves already-consistent counters untouched', async () => {
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'success', structured_output: validReport }])
      );

      const report = await new CodeReviewOrchestrator().reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        2
      );

      expect(report.summary).toMatchObject({
        totalFiles: 1,
        overallScore: 80,
        criticalIssues: 0,
        highPriorityTests: 1,
        refactoringOpportunities: 0
      });
    });

    it('fails with a typed error when no structured output is returned', async () => {
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'error_during_execution' }])
      );

      await expect(
        new CodeReviewOrchestrator({ maxRetries: 1 }).reviewPullRequest('o', 'r', 1)
      ).rejects.toMatchObject({ code: 'RETRY_EXHAUSTED' });
    });

    it('fails with a typed error when the output violates the schema', async () => {
      const invalid = { ...validReport, summary: { ...validReport.summary, totalFiles: 'one' } };
      queryMock.mockReturnValue(
        mockStream([{ type: 'result', subtype: 'success', structured_output: invalid }])
      );

      await expect(
        new CodeReviewOrchestrator({ maxRetries: 1 }).reviewPullRequest('o', 'r', 1)
      ).rejects.toMatchObject({ code: 'RETRY_EXHAUSTED' });
    });

    it('retries a transient SDK failure before succeeding', async () => {
      queryMock
        .mockImplementationOnce(() => {
          throw new Error('socket hang up');
        })
        .mockReturnValueOnce(
          mockStream([{ type: 'result', subtype: 'success', structured_output: validReport }])
        );

      const report = await new CodeReviewOrchestrator({ maxRetries: 2 }).reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        2
      );

      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(report.summary.totalFiles).toBe(1);
    });
  });

  describe('Agent definitions', () => {
    const agents = [codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester];

    it('inherit the orchestrator model', () => {
      for (const agent of agents) expect(agent.model).toBe('inherit');
    });

    it('each expose the Skill tool for the skills library', () => {
      for (const agent of agents) expect(agent.tools).toContain('Skill');
    });

    it('each carry a description and a prompt', () => {
      for (const agent of agents) {
        expect(agent.description.length).toBeGreaterThan(40);
        expect(agent.prompt.length).toBeGreaterThan(100);
      }
    });

    it('give the code quality analyzer access to ESLint MCP linting', () => {
      expect(codeQualityAnalyzer.tools).toContain('mcp__eslint__lint-files');
    });

    it('give the coverage analyzer search tools for locating test files', () => {
      expect(testCoverageAnalyzer.tools).toEqual(expect.arrayContaining(['Glob', 'Grep']));
    });
  });

  describe('MCP configuration', () => {
    it('configures the GitHub server over stdio via npx', () => {
      expect(mcpServersConfig.github.type).toBe('stdio');
      expect(mcpServersConfig.github.command).toBe('npx');
      expect(mcpServersConfig.github.args).toContain('@modelcontextprotocol/server-github');
    });

    it('maps GITHUB_TOKEN to the server-expected env var name', () => {
      expect(mcpServersConfig.github.env).toHaveProperty('GITHUB_PERSONAL_ACCESS_TOKEN');
    });

    it('configures the ESLint server over stdio via npx', () => {
      expect(mcpServersConfig.eslint.type).toBe('stdio');
      expect(mcpServersConfig.eslint.command).toBe('npx');
      expect(mcpServersConfig.eslint.args).toContain('@eslint/mcp@latest');
    });
  });

  describe('Orchestrator prompt', () => {
    const prompt = buildOrchestratorPrompt({
      owner: 'airaamane',
      repo: 'simple-todo-app',
      prNumber: 3
    });

    it('names the target pull request', () => {
      expect(prompt).toContain('airaamane');
      expect(prompt).toContain('simple-todo-app');
      expect(prompt).toContain('3');
    });

    it('instructs the model to fetch PR data through GitHub MCP', () => {
      expect(prompt).toContain('mcp__github__');
    });

    it('uses explicit "Use the <agent> agent" invocation language', () => {
      expect(prompt).toContain('Use the code-quality-analyzer agent');
      expect(prompt).toContain('Use the test-coverage-analyzer agent');
      expect(prompt).toContain('Use the refactoring-suggester agent');
    });

    it('describes the ReviewReport output structure', () => {
      for (const key of ['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata']) {
        expect(prompt).toContain(key);
      }
    });

    it('tells the orchestrator to continue when an agent fails', () => {
      expect(prompt).toMatch(/Never abort the whole review|continue with the others/i);
    });
  });

  describe('Integration', () => {
    /**
     * Live end-to-end check against a real public PR. Skipped by default because
     * it needs valid API credentials and spends tokens; run manually with:
     *   npm run dev -- octocat Hello-World 1
     * Evidence of a real run is captured in reports/ and the run logs.
     */
    it.skip('reviews a real small PR end to end', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
      expect(report.summary.totalFiles).toBeGreaterThanOrEqual(0);
    });
  });
});
