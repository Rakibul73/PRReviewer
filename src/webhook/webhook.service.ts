import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Webhooks } from '@octokit/webhooks';
import { ReviewService, PullRequestPayload } from '../review/review.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly webhooks: Webhooks;

  constructor(
    private readonly configService: ConfigService,
    private readonly reviewService: ReviewService,
  ) {
    const secret = this.configService.get<string>('github.webhookSecret');
    if (!secret) {
      throw new Error('GITHUB_WEBHOOK_SECRET is not configured');
    }
    this.webhooks = new Webhooks({ secret });
  }

  async verifyAndRoute(payload: string, signature: string): Promise<void> {
    // Verify HMAC-SHA256 signature
    const isValid = await this.webhooks.verify(payload, signature);
    if (!isValid) {
      this.logger.warn('Webhook signature verification failed');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Parse the payload — never log it as it may contain sensitive code
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      this.logger.warn('Failed to parse webhook payload as JSON');
      return;
    }

    const action = parsed['action'];
    const event = parsed;

    if (typeof action !== 'string') {
      this.logger.debug('Webhook payload has no action field — ignoring');
      return;
    }

    // Route based on action
    switch (action) {
      case 'opened':
      case 'synchronize':
      case 'reopened': {
        this.logger.log(`Handling pull_request.${action}`);
        // Fire and forget — do not await, webhook must return 200 quickly
        void this.reviewService.reviewPullRequest(event as unknown as PullRequestPayload);
        break;
      }
      default: {
        this.logger.debug(`Ignoring pull_request.${action}`);
        break;
      }
    }
  }
}
