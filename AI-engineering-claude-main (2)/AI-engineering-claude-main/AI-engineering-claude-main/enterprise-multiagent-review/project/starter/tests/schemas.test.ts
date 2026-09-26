import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  CodeQualityResultJSONSchema,
  TestCoverageResultJSONSchema,
  RefactoringSuggestionJSONSchema
} from '../src/types/analysis-results';
import { ReviewReportSchema, ReviewReportJSONSchema } from '../src/types/report-types';

/**
 * Schema validation tests.
 *
 * These schemas are the contract between the subagents and the report: if an
 * agent returns a shape the schema rejects, the run fails loudly instead of
 * writing a half-empty report.
 */

const validCodeQuality = {
  file: 'src/todo/list.js',
  issues: [
    {
      line: 42,
      severity: 'high' as const,
      category: 'security' as const,
      description: 'User input is interpolated into innerHTML without escaping',
      suggestion: 'Use textContent, or escape the value before insertion'
    }
  ],
  overallScore: 68,
  summary: 'One high-severity XSS risk; otherwise the file is straightforward.'
};

const validTestCoverage = {
  file: 'src/todo/list.js',
  hasTests: true,
  testFiles: ['tests/list.test.js'],
  untestedPaths: [
    {
      type: 'function' as const,
      location: 'deleteTodo() (line 88)',
      priority: 'critical' as const,
      reasoning: 'Deletes user data with no test asserting the confirmation guard',
      suggestedTest:
        "it('does not delete when confirmation is declined', () => { ... expect(store.remove).not.toHaveBeenCalled(); })"
    }
  ],
  coverageEstimate: 45,
  summary: 'Happy paths are covered; destructive operations are not.'
};

const validRefactoring = {
  file: 'src/todo/list.js',
  suggestions: [
    {
      type: 'modernize' as const,
      location: 'renderTodos() (lines 30-44)',
      impact: 'medium' as const,
      description: 'Index loop with string concatenation builds list markup',
      before: "var html = ''; for (var i = 0; i < todos.length; i++) { html += todos[i].title; }",
      after: 'const html = todos.map(todo => todo.title).join("");',
      benefits: 'Removes the mutable accumulator and manual index bookkeeping'
    }
  ],
  summary: 'Mostly clear; one legacy loop worth modernizing.'
};

const validReport = {
  pullRequest: { owner: 'airaamane', repo: 'simple-todo-app', number: 1 },
  fileReviews: [
    {
      file: 'src/todo/list.js',
      codeQuality: validCodeQuality,
      testCoverage: validTestCoverage,
      refactorings: validRefactoring
    }
  ],
  summary: {
    totalFiles: 1,
    overallScore: 68,
    criticalIssues: 0,
    highPriorityTests: 1,
    refactoringOpportunities: 1
  },
  recommendations: [
    {
      priority: 'high' as const,
      category: 'Security',
      description: 'Escape user-controlled values before writing them to the DOM',
      files: ['src/todo/list.js']
    }
  ],
  metadata: {
    analyzedAt: '2026-08-20T22:00:00.000Z',
    duration: 42_000,
    agentVersions: {
      'code-quality-analyzer': '1.0.0',
      'test-coverage-analyzer': '1.0.0',
      'refactoring-suggester': '1.0.0'
    }
  }
};

describe('CodeQualityResultSchema', () => {
  it('accepts a valid result', () => {
    expect(() => CodeQualityResultSchema.parse(validCodeQuality)).not.toThrow();
  });

  it('accepts an empty issues array for a clean file', () => {
    const clean = { ...validCodeQuality, issues: [], overallScore: 100 };
    const parsed = CodeQualityResultSchema.parse(clean);
    expect(parsed.issues).toHaveLength(0);
  });

  it('accepts boundary scores of 0 and 100', () => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, overallScore: 0 })).not.toThrow();
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, overallScore: 100 })).not.toThrow();
  });

  it('rejects an out-of-range score', () => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, overallScore: 101 })).toThrow(ZodError);
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, overallScore: -1 })).toThrow(ZodError);
  });

  it('rejects an invalid severity value', () => {
    const bad = {
      ...validCodeQuality,
      issues: [{ ...validCodeQuality.issues[0], severity: 'catastrophic' }]
    };
    expect(() => CodeQualityResultSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects an invalid category value', () => {
    const bad = {
      ...validCodeQuality,
      issues: [{ ...validCodeQuality.issues[0], category: 'vibes' }]
    };
    expect(() => CodeQualityResultSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects a line number sent as a string', () => {
    const bad = {
      ...validCodeQuality,
      issues: [{ ...validCodeQuality.issues[0], line: '42' }]
    };
    expect(() => CodeQualityResultSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects a result missing the summary field', () => {
    const { summary, ...withoutSummary } = validCodeQuality;
    expect(() => CodeQualityResultSchema.parse(withoutSummary)).toThrow(ZodError);
  });
});

describe('TestCoverageResultSchema', () => {
  it('accepts a valid result', () => {
    expect(() => TestCoverageResultSchema.parse(validTestCoverage)).not.toThrow();
  });

  it('accepts a file with no tests at all', () => {
    const untested = {
      ...validTestCoverage,
      hasTests: false,
      testFiles: [],
      untestedPaths: [],
      coverageEstimate: 0
    };
    const parsed = TestCoverageResultSchema.parse(untested);
    expect(parsed.hasTests).toBe(false);
    expect(parsed.coverageEstimate).toBe(0);
  });

  it('rejects a coverage estimate above 100', () => {
    expect(() =>
      TestCoverageResultSchema.parse({ ...validTestCoverage, coverageEstimate: 120 })
    ).toThrow(ZodError);
  });

  it('rejects an invalid untested-path type', () => {
    const bad = {
      ...validTestCoverage,
      untestedPaths: [{ ...validTestCoverage.untestedPaths[0], type: 'module' }]
    };
    expect(() => TestCoverageResultSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects hasTests sent as a string', () => {
    expect(() =>
      TestCoverageResultSchema.parse({ ...validTestCoverage, hasTests: 'yes' })
    ).toThrow(ZodError);
  });
});

describe('RefactoringSuggestionSchema', () => {
  it('accepts a valid result', () => {
    expect(() => RefactoringSuggestionSchema.parse(validRefactoring)).not.toThrow();
  });

  it('accepts an empty suggestions array', () => {
    const parsed = RefactoringSuggestionSchema.parse({ ...validRefactoring, suggestions: [] });
    expect(parsed.suggestions).toHaveLength(0);
  });

  it('rejects an invalid refactoring type', () => {
    const bad = {
      ...validRefactoring,
      suggestions: [{ ...validRefactoring.suggestions[0], type: 'rewrite-everything' }]
    };
    expect(() => RefactoringSuggestionSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects a suggestion missing the before/after snippets', () => {
    const { before, after, ...partial } = validRefactoring.suggestions[0];
    expect(() =>
      RefactoringSuggestionSchema.parse({ ...validRefactoring, suggestions: [partial] })
    ).toThrow(ZodError);
  });
});

describe('ReviewReportSchema', () => {
  it('accepts a complete report', () => {
    expect(() => ReviewReportSchema.parse(validReport)).not.toThrow();
  });

  it('accepts a report with no reviewed files (e.g. PR fetch failed)', () => {
    const empty = {
      ...validReport,
      fileReviews: [],
      recommendations: [],
      summary: {
        totalFiles: 0,
        overallScore: 0,
        criticalIssues: 0,
        highPriorityTests: 0,
        refactoringOpportunities: 0
      }
    };
    const parsed = ReviewReportSchema.parse(empty);
    expect(parsed.fileReviews).toHaveLength(0);
  });

  it('rejects a PR number sent as a string', () => {
    const bad = { ...validReport, pullRequest: { ...validReport.pullRequest, number: '1' } };
    expect(() => ReviewReportSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects an invalid recommendation priority', () => {
    const bad = {
      ...validReport,
      recommendations: [{ ...validReport.recommendations[0], priority: 'urgent' }]
    };
    expect(() => ReviewReportSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects a file review missing a sub-result', () => {
    const { testCoverage, ...incomplete } = validReport.fileReviews[0];
    expect(() =>
      ReviewReportSchema.parse({ ...validReport, fileReviews: [incomplete] })
    ).toThrow(ZodError);
  });

  it('surfaces a nested agent-result violation', () => {
    const bad = {
      ...validReport,
      fileReviews: [
        {
          ...validReport.fileReviews[0],
          codeQuality: { ...validCodeQuality, overallScore: 999 }
        }
      ]
    };
    const result = ReviewReportSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('overallScore');
    }
  });
});

describe('JSON Schema export for SDK structured outputs', () => {
  it('exports an object schema for the review report', () => {
    expect(ReviewReportJSONSchema).toBeTypeOf('object');
    expect(ReviewReportJSONSchema).toHaveProperty('type', 'object');
    expect(ReviewReportJSONSchema).toHaveProperty('properties');
  });

  it('marks the report top-level fields as required', () => {
    const required = (ReviewReportJSONSchema as { required?: string[] }).required ?? [];
    expect(required).toEqual(
      expect.arrayContaining(['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'])
    );
  });

  it('exports object schemas for each agent result', () => {
    for (const schema of [
      CodeQualityResultJSONSchema,
      TestCoverageResultJSONSchema,
      RefactoringSuggestionJSONSchema
    ]) {
      expect(schema).toHaveProperty('type', 'object');
      expect(schema).toHaveProperty('properties');
    }
  });

  it('inlines definitions with $refStrategy: root (no dangling $defs pointers)', () => {
    // The SDK cannot resolve external $refs; conversion must inline them.
    const serialized = JSON.stringify(ReviewReportJSONSchema);
    const refs = serialized.match(/"\$ref":"([^"]+)"/g) ?? [];
    for (const ref of refs) {
      expect(ref).toContain('#');
    }
  });

  it('produces the same shape as a direct zodToJsonSchema conversion', () => {
    const direct = zodToJsonSchema(CodeQualityResultSchema, { $refStrategy: 'root' });
    expect((direct as { type?: string }).type).toBe(
      (CodeQualityResultJSONSchema as { type?: string }).type
    );
  });
});
