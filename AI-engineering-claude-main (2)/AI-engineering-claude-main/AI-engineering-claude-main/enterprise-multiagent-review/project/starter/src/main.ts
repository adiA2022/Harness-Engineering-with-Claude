import * as dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Load environment variables
dotenv.config();

import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator, logger, formatError, isReviewError } from './utils/index.js';

const USAGE = `
Usage: npm run dev -- <owner> <repo> <pr-number>

Arguments:
  owner       GitHub repository owner (user or organization)
  repo        Repository name
  pr-number   Pull request number (positive integer)

Example:
  npm run dev -- airaamane simple-todo-app 1
`;

interface CliArgs {
  owner: string;
  repo: string;
  prNumber: number;
}

/**
 * Parse and validate the three positional arguments.
 * Exits with a usage message rather than throwing a stack trace at the user.
 */
function parseArgs(argv: string[]): CliArgs {
  const [owner, repo, prStr] = argv;

  if (!owner || !repo || !prStr) {
    console.error('❌ Missing required arguments.');
    console.error(USAGE);
    process.exit(1);
  }

  // parseInt with an explicit radix; Number() would accept '1.5' and ' 1 '.
  const prNumber = parseInt(prStr, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0 || String(prNumber) !== prStr.trim()) {
    console.error(`❌ Invalid PR number: "${prStr}". It must be a positive integer.`);
    console.error(USAGE);
    process.exit(1);
  }

  return { owner, repo, prNumber };
}

/**
 * Verify exactly one supported authentication method is configured.
 */
function validateAuth(): void {
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasAwsCreds =
    Boolean(process.env.AWS_ACCESS_KEY_ID) && Boolean(process.env.AWS_SECRET_ACCESS_KEY);

  if (hasAwsCreds) {
    if (!process.env.AWS_REGION) {
      console.error('❌ AWS credentials found but AWS_REGION is not set.');
      console.error('   Add AWS_REGION=us-east-1 (or your region) to your .env file.');
      process.exit(1);
    }
    console.log('🔐 Using AWS Bedrock authentication');
    return;
  }

  if (hasAnthropicKey) {
    console.log('🔐 Using Anthropic API authentication');
    return;
  }

  console.error('❌ No authentication configured. Set ONE of the following in your .env:');
  console.error('');
  console.error('   Option 1 — Anthropic API:');
  console.error('     ANTHROPIC_API_KEY=sk-ant-...');
  console.error('');
  console.error('   Option 2 — AWS Bedrock:');
  console.error('     AWS_ACCESS_KEY_ID=...');
  console.error('     AWS_SECRET_ACCESS_KEY=...');
  console.error('     AWS_REGION=us-east-1');
  process.exit(1);
}

/**
 * ANTHROPIC_MODEL is required for both auth paths and has a different format per path.
 */
function validateModel(): string {
  const model = process.env.ANTHROPIC_MODEL;
  if (!model) {
    console.error('❌ ANTHROPIC_MODEL environment variable is required.');
    console.error('   For the Anthropic API:  ANTHROPIC_MODEL=claude-sonnet-4-5-20250929');
    console.error('   For AWS Bedrock:        ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    process.exit(1);
  }
  return model;
}

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main(): Promise<void> {
  const { owner, repo, prNumber } = parseArgs(process.argv.slice(2));

  validateAuth();
  const model = validateModel();

  if (!process.env.GITHUB_TOKEN) {
    console.warn('⚠️  GITHUB_TOKEN not set — using unauthenticated GitHub access (lower rate limits).');
  }

  console.log(`\n🔍 Reviewing ${owner}/${repo}#${prNumber} with ${model}\n`);

  try {
    const orchestrator = new CodeReviewOrchestrator();
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    const generator = new ReportGenerator();
    const reportsDir = resolve(process.cwd(), 'reports');
    await mkdir(reportsDir, { recursive: true });

    const base = `${owner}_${repo}_${prNumber}`;
    const outputs: Array<[string, string]> = [
      [`${base}.json`, generator.generateJSONReport(report)],
      [`${base}.md`, generator.generateMarkdownReport(report)],
      [`${base}.html`, generator.generateHTMLReport(report)]
    ];

    for (const [filename, contents] of outputs) {
      const path = join(reportsDir, filename);
      await writeFile(path, contents, 'utf-8');
      console.log(`✅ Wrote ${path}`);
    }

    console.log(`\n📊 Overall score: ${report.summary.overallScore}/100`);
    console.log(`   Files reviewed:          ${report.summary.totalFiles}`);
    console.log(`   Critical issues:         ${report.summary.criticalIssues}`);
    console.log(`   High-priority tests:     ${report.summary.highPriorityTests}`);
    console.log(`   Refactoring suggestions: ${report.summary.refactoringOpportunities}\n`);
  } catch (error) {
    // Friendly, actionable messages — never a raw stack trace.
    logger.error('Review failed', { error: formatError(error) });
    console.error(`\n❌ Review failed: ${formatError(error)}`);

    if (isReviewError(error)) {
      switch (error.code) {
        case 'PR_NOT_FOUND':
          console.error(`   Check that ${owner}/${repo}#${prNumber} exists and is accessible.`);
          break;
        case 'RATE_LIMITED':
          console.error('   Set GITHUB_TOKEN in your .env for higher GitHub rate limits, then retry.');
          break;
        case 'AGENT_TIMEOUT':
          console.error('   The review exceeded its time budget. Try a PR with fewer changed files.');
          break;
        case 'VALIDATION_FAILED':
        case 'STRUCTURED_OUTPUT_FAILED':
          console.error('   The agents returned output that did not match the report schema.');
          console.error('   Re-run the review; if it persists, check the agent prompts.');
          break;
        default:
          console.error('   Run with LOG_LEVEL=debug in your .env for more detail.');
      }
    } else {
      console.error('   Run with LOG_LEVEL=debug in your .env for more detail.');
    }

    process.exit(1);
  }
}

main();
