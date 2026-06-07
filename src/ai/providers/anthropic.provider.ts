import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { AiProvider, AiRequestOptions, AiResponse } from './provider.interface';

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly logger = new Logger('AnthropicProvider');

  // Best Claude model available for code review
  private readonly model = 'claude-sonnet-4-20250514';

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(opts: AiRequestOptions): Promise<AiResponse> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    });

    const text = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
    this.logger.debug(`Anthropic response: ${message.usage.output_tokens} output tokens`);
    return { text };
  }
}
