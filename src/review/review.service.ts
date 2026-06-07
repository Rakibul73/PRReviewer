import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { GithubService } from '../github/github.service';
import { AiService, FileReview } from '../ai/ai.service';
import { parseDiff, DiffHunk } from '../github/diff.parser';

export interface PullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    number: number;
    head: {
      sha: string;
      ref: string;
    };
    base: {
      ref: string;
    };
    title: string;
    draft: boolean;
  };
  repository: {
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
  };
  installation?: {
    id: number;
  };
  sender: {
    login: string;
  };
}

const LOCK_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'go.sum',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
]);

const GENERATED_PATTERNS = [
  /\.min\.js$/,
  /\.generated\.[^.]+$/,
  /^dist\//,
  /^build\//,
  /\/dist\//,
  /\/build\//,
];

const MAX_FILES_TO_REVIEW = 20;

function isLockFile(filename: string): boolean {
  const basename = filename.split('/').pop() ?? filename;
  return LOCK_FILES.has(basename);
}

function isGeneratedFile(filename: string): boolean {
  return GENERATED_PATTERNS.some((pattern) => pattern.test(filename));
}

function parseVerdictFromSummary(summary: string): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
  const upper = summary.toUpperCase();
  if (upper.includes('REQUEST_CHANGES')) return 'REQUEST_CHANGES';
  if (upper.includes('APPROVE')) return 'APPROVE';
  return 'COMMENT';
}

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly githubService: GithubService,
    private readonly aiService: AiService,
    private readonly configService: ConfigService,
  ) {}

  async reviewPullRequest(payload: PullRequestPayload): Promise<void> {
    try {
      await this.doReview(payload);
    } catch (err) {
      // Never rethrow — webhook endpoint must always return 200
      this.logger.error(
        'Unhandled error in reviewPullRequest',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async doReview(payload: PullRequestPayload): Promise<void> {
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const pullNumber = payload.pull_request.number;
    const commitSha = payload.pull_request.head.sha;
    const installationId = payload.installation?.id;

    if (!installationId || !Number.isInteger(installationId) || installationId <= 0) {
      this.logger.error(`Invalid installationId: ${String(installationId)}`);
      return;
    }

    this.logger.log(`[PRReviewer] Starting review for ${owner}/${repo}#PR${pullNumber} (commit: ${commitSha.slice(0, 7)})`);

    const appName = this.configService.get<string>('github.appName') ?? 'prreviewer-bot';

    // Get authenticated Octokit for this installation
    let octokit;
    try {
      octokit = await this.githubService.getInstallationOctokit(installationId);
    } catch (err) {
      this.logger.error(
        `Failed to get installation Octokit (app may be uninstalled): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    // Check if bot already reviewed this exact commit
    const alreadyReviewed = await this.githubService.hasBotAlreadyReviewed(
      octokit,
      owner,
      repo,
      pullNumber,
      appName,
      commitSha,
    );

    if (alreadyReviewed) {
      this.logger.log(`[PRReviewer] Already reviewed commit ${commitSha.slice(0, 7)} — skipping`);
      return;
    }

    // Fetch raw diff
    let rawDiff: string;
    try {
      rawDiff = await this.githubService.getPRDiff(octokit, owner, repo, pullNumber);
    } catch (err) {
      this.logger.error(
        `Failed to fetch PR diff: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    if (!rawDiff || rawDiff.trim() === '') {
      await this.postNoChangesComment(octokit, owner, repo, pullNumber, 'No changes to review.');
      return;
    }

    // Parse the diff
    const allHunks = parseDiff(rawDiff);

    // Filter reviewable files
    let reviewableHunks: DiffHunk[] = allHunks.filter((hunk) => {
      if (hunk.status === 'deleted') return false;
      if (hunk.additions === 0) return false;
      if (isLockFile(hunk.filename)) return false;
      if (isGeneratedFile(hunk.filename)) return false;
      return true;
    });

    if (reviewableHunks.length === 0) {
      await this.postNoChangesComment(
        octokit,
        owner,
        repo,
        pullNumber,
        'No reviewable files found (all changes are in lock files, generated files, or deletions).',
      );
      return;
    }

    // Limit to first 20 files
    let truncatedNote = '';
    if (reviewableHunks.length > MAX_FILES_TO_REVIEW) {
      this.logger.log(
        `[PRReviewer] PR has ${reviewableHunks.length} files — limiting to first ${MAX_FILES_TO_REVIEW}`,
      );
      reviewableHunks = reviewableHunks.slice(0, MAX_FILES_TO_REVIEW);
      truncatedNote = `\n\n> **Note:** Only the first ${MAX_FILES_TO_REVIEW} files were reviewed due to the size of this PR.`;
    }

    this.logger.log(`[PRReviewer] Reviewing ${reviewableHunks.length} files...`);

    // Review each file sequentially (not parallel — avoid rate limits)
    const fileReviews: FileReview[] = [];
    const sleep = this.aiService.getSleepFn();

    for (let i = 0; i < reviewableHunks.length; i++) {
      const hunk = reviewableHunks[i];
      if (i > 0) {
        await sleep(500);
      }

      try {
        const review = await this.aiService.reviewFile(hunk);
        fileReviews.push(review);
        this.logger.debug(`Reviewed ${hunk.filename}: ${review.comments.length} comments`);
      } catch (err) {
        this.logger.warn(
          `Skipping ${hunk.filename} due to error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Build PR summary
    let summaryBody = await this.aiService.buildPRSummary(fileReviews);

    if (truncatedNote) {
      summaryBody += truncatedNote;
    }

    // Parse verdict from summary
    const verdict = parseVerdictFromSummary(summaryBody);

    // Only include file reviews that have comments
    const reviewsWithComments = fileReviews.filter((r) => r.comments.length > 0);

    // Post the review
    await this.githubService.postReviewComments({
      octokit,
      owner,
      repo,
      pullNumber,
      commitSha,
      fileReviews: reviewsWithComments,
      summaryBody,
      verdict,
    });

    const totalComments = reviewsWithComments.reduce((sum, r) => sum + r.comments.length, 0);
    this.logger.log(
      `[PRReviewer] Review posted — ${totalComments} comments across ${reviewsWithComments.length} files`,
    );
  }

  private async postNoChangesComment(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
    message: string,
  ): Promise<void> {
    try {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: `## PRReviewer\n\n${message}`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to post no-changes comment: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
