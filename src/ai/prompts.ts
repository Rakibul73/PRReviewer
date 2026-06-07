import { DiffHunk } from '../github/diff.parser';
import { FileReview } from './ai.service';

const REVIEWER_SYSTEM_PROMPT = `You are an expert code reviewer. You review pull request diffs and provide specific, actionable feedback. You focus on:
- Bugs and logic errors
- Security vulnerabilities (SQL injection, XSS, missing auth checks, secrets in code)
- Missing error handling
- Performance issues
- TypeScript/type safety issues
- Naming and readability problems

You do NOT comment on:
- Code style or formatting (that's what linters are for)
- Personal preferences
- Things that are already correct

Be concise. Maximum 2 sentences per comment. Be direct, not diplomatic.
If the code looks good, say so — do not invent issues.`;

export function buildReviewPrompt(hunk: DiffHunk): { system: string; user: string } {
  const user = `Review this ${hunk.language} code change in file: ${hunk.filename}

${hunk.patch}

Respond ONLY with a JSON object in this exact shape (no markdown, no preamble):
{
  "summary": "One sentence overall assessment of this file's changes.",
  "comments": [
    {
      "line": <new file line number as integer>,
      "severity": "error" | "warning" | "suggestion",
      "comment": "Specific actionable feedback in max 2 sentences."
    }
  ]
}

Rules:
- Only reference line numbers that appear in the diff above
- If no issues found, return { "summary": "...", "comments": [] }
- Maximum 5 comments per file
- Do not wrap in markdown code blocks`;

  return { system: REVIEWER_SYSTEM_PROMPT, user };
}

export function buildSummaryPrompt(allComments: FileReview[]): { system: string; user: string } {
  const system = `You are a senior software engineer writing a pull request review summary. Be concise, professional, and actionable.`;

  const filesSummary = allComments
    .map((r) => {
      const commentLines = r.comments
        .map((c) => `  - [${c.severity.toUpperCase()}] Line ${c.line}: ${c.comment}`)
        .join('\n');
      return `**${r.filename}**: ${r.summary}${r.comments.length > 0 ? '\n' + commentLines : ''}`;
    })
    .join('\n\n');

  const user = `Based on these per-file reviews, write an overall PR review summary.

${filesSummary}

Write a markdown-formatted summary of at most 150 words. End with a verdict on its own line:
- If all changes look correct and safe: APPROVE
- If there are bugs, security issues, or errors that must be fixed: REQUEST_CHANGES
- If there are only suggestions or minor warnings: COMMENT

Format:
## PR Review Summary

<your summary here>

**Verdict: APPROVE | REQUEST_CHANGES | COMMENT**`;

  return { system, user };
}
