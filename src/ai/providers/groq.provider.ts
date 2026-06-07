import Groq from 'groq-sdk';
import { Logger } from '@nestjs/common';
import { AiProvider, AiRequestOptions, AiResponse } from './provider.interface';

export class GroqProvider implements AiProvider {
  readonly name = 'groq';
  private readonly client: Groq;
  private readonly logger = new Logger('GroqProvider');

  // Best Groq model for code review — fast and capable
  private readonly model = 'llama-3.3-70b-versatile';

  constructor(apiKey: string) {
    this.client = new Groq({ apiKey });
  }

  async complete(opts: AiRequestOptions): Promise<AiResponse> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: opts.maxTokens,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      // Groq is very fast — no need for streaming here
      stream: false,
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? '';
    this.logger.debug(
      `Groq response: ${completion.usage?.completion_tokens ?? '?'} output tokens`,
    );
    return { text };
  }
}
