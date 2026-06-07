import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiffHunk } from '../github/diff.parser';
import { buildReviewPrompt, buildSummaryPrompt } from './prompts';
import {
  AiProvider,
  AiProviderName,
  AnthropicProvider,
  GroqProvider,
  GeminiProvider,
} from './providers';

export interface LineComment {
  line: number;
  severity: 'error' | 'warning' | 'suggestion';
  comment: string;
}

export interface FileReview {
  filename: string;
  summary: string;
  comments: LineComment[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createProvider(name: AiProviderName, configService: ConfigService): AiProvider {
  switch (name) {
    case 'anthropic': {
      const apiKey = configService.get<string>('ai.anthropic.apiKey');
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
      return new AnthropicProvider(apiKey);
    }
    case 'groq': {
      const apiKey = configService.get<string>('ai.groq.apiKey');
      if (!apiKey) throw new Error('GROQ_API_KEY is not configured');
      return new GroqProvider(apiKey);
    }
    case 'gemini': {
      const apiKey = configService.get<string>('ai.gemini.apiKey');
      if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
      return new GeminiProvider(apiKey);
    }
  }
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly provider: AiProvider;

  constructor(private readonly configService: ConfigService) {
    const providerName =
      configService.get<AiProviderName>('ai.provider') ?? 'anthropic';
    this.provider = createProvider(providerName, configService);
    this.logger.log(`AI provider: ${this.provider.name}`);
  }

  /** Returns the active provider name — useful for logging and summaries */
  getProviderName(): AiProviderName {
    return this.provider.name;
  }

  async reviewFile(hunk: DiffHunk): Promise<FileReview> {
    if (hunk.status === 'deleted') {
      return { filename: hunk.filename, summary: 'Deleted file — skipped.', comments: [] };
    }

    const { system, user } = buildReviewPrompt(hunk);

    // Collect all valid new-file line numbers from the diff
    const validNewLineNumbers = new Set<number>();
    for (const section of hunk.hunks) {
      for (const line of section.lines) {
        if (
          (line.type === 'added' || line.type === 'context') &&
          line.newLineNumber !== undefined
        ) {
          validNewLineNumbers.add(line.newLineNumber);
        }
      }
    }

    try {
      const { text } = await this.provider.complete({ system, user, maxTokens: 1024 });

      // Strip markdown code fences some providers add despite instructions
      const cleaned = stripCodeFences(text);

      let parsed: {
        summary: string;
        comments: Array<{ line: number; severity: string; comment: string }>;
      };

      try {
        parsed = JSON.parse(cleaned) as typeof parsed;
      } catch {
        this.logger.warn(
          `[${this.provider.name}] Failed to parse JSON for ${hunk.filename}: ${cleaned.slice(0, 200)}`,
        );
        return { filename: hunk.filename, summary: 'Review failed to parse.', comments: [] };
      }

      // Validate and filter comments
      const validComments: LineComment[] = [];
      for (const c of parsed.comments ?? []) {
        if (typeof c.line !== 'number' || !validNewLineNumbers.has(c.line)) {
          this.logger.debug(
            `[${this.provider.name}] Dropping comment with invalid line ${c.line} in ${hunk.filename}`,
          );
          continue;
        }
        const severity = (['error', 'warning', 'suggestion'] as const).includes(
          c.severity as LineComment['severity'],
        )
          ? (c.severity as LineComment['severity'])
          : 'suggestion';

        validComments.push({ line: c.line, severity, comment: String(c.comment) });
      }

      return {
        filename: hunk.filename,
        summary: String(parsed.summary ?? ''),
        comments: validComments,
      };
    } catch (err) {
      this.logger.error(
        `[${this.provider.name}] Review failed for ${hunk.filename}`,
        err instanceof Error ? err.stack : String(err),
      );
      return { filename: hunk.filename, summary: 'Review failed due to an API error.', comments: [] };
    }
  }

  async buildPRSummary(reviews: FileReview[]): Promise<string> {
    const reviewsWithComments = reviews.filter((r) => r.comments.length > 0);
    if (reviewsWithComments.length === 0) {
      return '## PR Review Summary\n\nNo significant issues found across the reviewed files.\n\n**Verdict: APPROVE**';
    }

    const { system, user } = buildSummaryPrompt(reviewsWithComments);

    try {
      const { text } = await this.provider.complete({ system, user, maxTokens: 512 });
      return text || '## PR Review Summary\n\nUnable to generate summary.\n\n**Verdict: COMMENT**';
    } catch (err) {
      this.logger.error(
        `[${this.provider.name}] Failed to build PR summary`,
        err instanceof Error ? err.stack : String(err),
      );
      return '## PR Review Summary\n\nUnable to generate summary.\n\n**Verdict: COMMENT**';
    }
  }

  getSleepFn(): (ms: number) => Promise<void> {
    return sleep;
  }
}

/**
 * Some models (Gemini, older Groq responses) wrap JSON in ```json ... ``` fences
 * even when instructed not to. Strip them before parsing.
 */
function stripCodeFences(text: string): string {
  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/m.exec(text);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  return text;
}
