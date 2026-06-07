import {
  Controller,
  Post,
  Get,
  Headers,
  HttpCode,
  Req,
  Logger,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { WebhookService } from './webhook.service';

@Controller()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: FastifyRequest,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<{ ok: boolean }> {
    // Use raw body for signature verification
    // IMPORTANT: must use raw body, not parsed JSON
    // Signature verification fails if you use the parsed body
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';

    await this.webhookService.verifyAndRoute(rawBody, signature);
    return { ok: true };
  }

  @Get('health')
  @HttpCode(200)
  health(): { status: string } {
    return { status: 'ok' };
  }
}
