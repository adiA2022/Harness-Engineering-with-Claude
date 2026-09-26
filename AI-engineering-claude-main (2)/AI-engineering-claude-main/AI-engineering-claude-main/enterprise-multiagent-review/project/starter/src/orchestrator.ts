import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition, Options } from '@anthropic-ai/claude-agent-sdk';

import { ReviewReport, ReviewReportSchema, ReviewReportJSONSchema } from './types/report-types.js';
import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester
} from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { mcpServersConfig } from './config/mcp.config.js';
import {
  logger,
  RateLimiter,
  ReviewError,
  ErrorCodes,
  withRetry,
  withTimeout,
  formatError
} from './utils/index.js';
import type { RateLimiterConfig } from './utils/index.js';

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  /** Model to drive the orchestrator and (via 'inherit') its subagents. */
  model?: string;
  /** Upper bound on orchestration turns; multi-agent coordination needs headroom. */
  maxTurns?: number;
  /** Hard ceiling on a single review before it is abandoned (ms). */
  timeoutMs?: number;
  /** Retry attempts for transient failures (network, 429, 5xx). */
  maxRetries?: number;
  /** Overrides for the API rate limiter. */
  rateLimits?: Partial<RateLimiterConfig>;
}

/** Subagent registry — keys are the names the orchestrator uses in Task calls. */
const AGENTS: Record<string, AgentDefinition> = {
  'code-quality-analyzer': codeQualityAnalyzer,
  'test-coverage-analyzer': testCoverageAnalyzer,
  'refactoring-suggester': refactoringSuggester
};

/**
 * Tools the orchestrator itself may use.
 *
 * `Task` is what spawns the subagents — without it the specialists never run.
 * The GitHub MCP tools fetch the pull request; ESLint MCP backs static analysis;
 * Read/Grep/Glob/Skill let the orchestrator and its agents inspect code.
 */
const ALLOWED_TOOLS = [
  'Task',
  'Read',
  'Grep',
  'Glob',
  'Skill',
  'mcp__github__pull_request_read',
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_pull_request_diff',
  'mcp__github__get_file_contents',
  'mcp__github__search_code',
  'mcp__eslint__lint-files'
];

const DEFAULTS = {
  maxTurns: 80,
  // A multi-file PR spawns 3 subagent tasks per file; measured runs range from
  // ~3.5 min (1 file) to ~25 min (4-6 files) depending on API latency, so the
  // budget has to accommodate the slow end rather than the median.
  timeoutMs: 30 * 60 * 1000,
  maxRetries: 2
} as const;

/**
 * Recompute the report's summary counters from the per-file findings.
 *
 * The model is asked to keep these consistent, but in practice its arithmetic
 * drifts (observed: a report claiming 9 critical issues over file reviews
 * containing 6). Counting in code makes the headline numbers verifiable against
 * the detail a reader can scroll to, rather than a second opinion about it.
 */
function recomputeSummary(report: ReviewReport): ReviewReport['summary'] {
  const files = report.fileReviews;

  const criticalIssues = files.reduce(
    (n, f) => n + f.codeQuality.issues.filter(i => i.severity === 'critical').length,
    0
  );
  const highPriorityTests = files.reduce(
    (n, f) =>
      n +
      f.testCoverage.untestedPaths.filter(
        p => p.priority === 'critical' || p.priority === 'high'
      ).length,
    0
  );
  const refactoringOpportunities = files.reduce(
    (n, f) => n + f.refactorings.suggestions.length,
    0
  );
  const overallScore = files.length
    ? Math.round(
        files.reduce((sum, f) => sum + f.codeQuality.overallScore, 0) / files.length
      )
    : 0;

  return {
    totalFiles: files.length,
    overallScore,
    criticalIssues,
    highPriorityTests,
    refactoringOpportunities
  };
}

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private readonly model: string;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly rateLimiter: RateLimiter;

  constructor(options: OrchestratorOptions = {}) {
    // Model comes from the environment — never hardcoded — so deployments can switch
    // without a code change. Failing loudly beats silently reviewing with the wrong model.
    const model = options.model ?? process.env.ANTHROPIC_MODEL;
    if (!model) {
      throw new ReviewError(
        'ANTHROPIC_MODEL is not set. Export it or add it to your .env ' +
          '(e.g. ANTHROPIC_MODEL=claude-sonnet-4-5-20250929).',
        ErrorCodes.INVALID_CONFIG
      );
    }
    this.model = model;
    this.maxTurns = options.maxTurns ?? DEFAULTS.maxTurns;
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.rateLimiter = new RateLimiter(options.rateLimits ?? {});
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startedAt = Date.now();
    logger.info('Starting multi-agent review', { owner, repo, prNumber, model: this.model });

    // A full multi-agent review is token-heavy; reserve accordingly.
    await this.rateLimiter.acquire(50_000);

    try {
      const report = await withRetry(
        () =>
          withTimeout(
            () => this.runReview(owner, repo, prNumber),
            this.timeoutMs,
            `Review of ${owner}/${repo}#${prNumber} exceeded ${this.timeoutMs}ms`
          ),
        this.maxRetries,
        2000
      );

      // The model guesses at timing metadata; replace both with measured values
      // so the report's provenance reflects this run rather than an invented date.
      report.metadata.duration = Date.now() - startedAt;
      report.metadata.analyzedAt = new Date(startedAt).toISOString();

      // Headline counters are derived from the findings, never taken on trust.
      const claimed = report.summary;
      report.summary = recomputeSummary(report);
      if (
        claimed.criticalIssues !== report.summary.criticalIssues ||
        claimed.refactoringOpportunities !== report.summary.refactoringOpportunities ||
        claimed.totalFiles !== report.summary.totalFiles
      ) {
        logger.warn('Corrected summary counters that disagreed with the findings', {
          claimed,
          computed: report.summary
        });
      }

      logger.info('Review complete', {
        owner,
        repo,
        prNumber,
        files: report.summary.totalFiles,
        overallScore: report.summary.overallScore,
        durationMs: report.metadata.duration
      });

      return report;
    } finally {
      this.rateLimiter.release();
    }
  }

  /**
   * One orchestration pass: drive the SDK query, collect the structured output.
   */
  private async runReview(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const prompt = buildOrchestratorPrompt({ owner, repo, prNumber });

    const options: Options = {
      model: this.model,
      agents: AGENTS,
      mcpServers: mcpServersConfig,
      allowedTools: ALLOWED_TOOLS,
      maxTurns: this.maxTurns,
      // Unattended CI/CD use: no human is present to approve tool calls.
      permissionMode: 'bypassPermissions',
      // Load .claude/skills from the project directory so the Skill tool resolves.
      settingSources: ['project'],
      cwd: process.env.PROJECT_ROOT ?? process.cwd(),
      // Force the final answer through the ReviewReport JSON schema.
      outputFormat: {
        type: 'json_schema',
        schema: ReviewReportJSONSchema
      }
    };

    let structuredOutput: unknown;
    let resultSubtype: string | undefined;
    let resultText = '';

    for await (const message of query({ prompt, options })) {
      // The SDK's init message reports which MCP servers actually connected, which
      // agents registered, and which skills resolved — log it so a run is auditable.
      if (message.type === 'system' && message.subtype === 'init') {
        const servers = (message.mcp_servers ?? [])
          .map(s => `${s.name}=${s.status}`)
          .join(', ');
        logger.info('Session initialized', {
          mcpServers: servers || 'none',
          agents: message.agents ?? [],
          skills: message.skills ?? [],
          model: message.model,
          permissionMode: message.permissionMode
        });

        const failed = (message.mcp_servers ?? []).filter(s => s.status !== 'connected');
        if (failed.length > 0) {
          logger.warn('Some MCP servers did not connect', {
            failed: failed.map(s => `${s.name}=${s.status}`)
          });
        }
      }

      // Surface subagent activity so a long run is observable.
      if (message.type === 'assistant') {
        for (const block of message.message.content ?? []) {
          if (typeof block === 'object' && block !== null && 'name' in block) {
            const toolName = String((block as { name: unknown }).name);
            if (toolName === 'Task') {
              const input = (block as { input?: { subagent_type?: string } }).input;
              logger.info('Dispatching subagent', { agent: input?.subagent_type ?? 'unknown' });
            }
          }
        }
      }

      if (message.type === 'result') {
        resultSubtype = message.subtype;
        // structured_output is only present on the success variant of the union.
        structuredOutput = (message as { structured_output?: unknown }).structured_output;
        resultText = 'result' in message ? String(message.result ?? '') : '';
      }
    }

    if (!structuredOutput) {
      throw new ReviewError(
        `Orchestrator returned no structured output (subtype: ${resultSubtype ?? 'unknown'})` +
          (resultText ? `: ${resultText.slice(0, 300)}` : ''),
        ErrorCodes.STRUCTURED_OUTPUT_FAILED,
        { owner, repo, prNumber, subtype: resultSubtype }
      );
    }

    // safeParse (not parse) so a schema mismatch becomes a typed, actionable error.
    const parsed = ReviewReportSchema.safeParse(structuredOutput);
    if (!parsed.success) {
      logger.error('Structured output failed schema validation', {
        issues: parsed.error.issues.slice(0, 5)
      });
      throw new ReviewError(
        `Review report failed schema validation: ${formatError(parsed.error.issues[0]?.message)}`,
        ErrorCodes.VALIDATION_FAILED,
        { owner, repo, prNumber, issueCount: parsed.error.issues.length }
      );
    }

    return parsed.data;
  }
}
