import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { FileReview } from '../ai/ai.service';

interface CachedToken {
  token: string;
  expiresAt: Date;
}

interface PostReviewParams {
  octokit: Octokit;
  owner: string;
  repo: string;
  pullNumber: number;
  commitSha: string;
  fileReviews: FileReview[];
  summaryBody: string;
  verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private readonly tokenCache = new Map<number, CachedToken>();

  constructor(private readonly configService: ConfigService) {}

  async getInstallationOctokit(installationId: number): Promise<Octokit> {
    const cached = this.tokenCache.get(installationId);
    const now = new Date();

    // Use cached token if valid for at least 1 more minute
    if (cached) {
      const minuteFromNow = new Date(now.getTime() + 60 * 1000);
      if (cached.expiresAt > minuteFromNow) {
        return new Octokit({ auth: cached.token });
      }
    }

    const appId = this.configService.get<string>('github.appId');
    const privateKey = this.configService.get<string>('github.privateKey');

    if (!appId || !privateKey) {
      throw new Error('GitHub App credentials are not configured');
    }

    const auth = createAppAuth({
      appId,
      privateKey,
      installationId,
    });

    const installationAuth = await auth({ type: 'installation' });

    // GitHub installation tokens expire after 1 hour
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

    this.tokenCache.set(installationId, {
      token: installationAuth.token,
      expiresAt,
    });

    return new Octokit({ auth: installationAuth.token });
  }

  async getPRDiff(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string> {
    const response = await octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: { format: 'diff' },
    });

    // When using diff media type, the response data is the raw diff string
    return response.data as unknown as string;
  }

  async postReviewComments(params: PostReviewParams): Promise<void> {
    const { octokit, owner, repo, pullNumber, commitSha, fileReviews, summaryBody, verdict } = params;

    // Build inline comments array for GitHub's createReview API
    const inlineComments: Array<{
      path: string;
      line: number;
      side: 'RIGHT';
      body: string;
    }> = [];

    for (const fileReview of fileReviews) {
      for (const c of fileReview.comments) {
        inlineComments.push({
          path: fileReview.filename,
          line: c.line,
          side: 'RIGHT',
          body: `[${c.severity.toUpperCase()}] ${c.comment}`,
        });
      }
    }

    try {
      await octokit.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: commitSha,
        body: summaryBody,
        event: verdict,
        comments: inlineComments,
      });
      this.logger.log(`Review posted on ${owner}/${repo}#${pullNumber} with verdict ${verdict}`);
    } catch (err) {
      this.logger.warn(
        `createReview failed (likely invalid line numbers), falling back to issue comment: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      // Fallback: post summary as a regular issue comment
      try {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: pullNumber,
          body: summaryBody,
        });
        this.logger.log(`Fallback issue comment posted on ${owner}/${repo}#${pullNumber}`);
      } catch (fallbackErr) {
        this.logger.error(
          'Fallback issue comment also failed',
          fallbackErr instanceof Error ? fallbackErr.stack : String(fallbackErr),
        );
      }
    }
  }

  async hasBotAlreadyReviewed(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
    appName: string,
    commitSha: string,
  ): Promise<boolean> {
    try {
      const { data: reviews } = await octokit.pulls.listReviews({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      });

      return reviews.some(
        (review) =>
          review.user?.login?.toLowerCase().includes(appName.toLowerCase()) &&
          review.commit_id === commitSha,
      );
    } catch (err) {
      this.logger.warn(`Could not list reviews: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
