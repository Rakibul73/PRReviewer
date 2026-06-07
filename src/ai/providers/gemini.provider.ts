import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import { Logger } from '@nestjs/common';
import { AiProvider, AiRequestOptions, AiResponse } from './provider.interface';

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly genAI: GoogleGenerativeAI;
  private readonly logger = new Logger('GeminiProvider');

  // Best Gemini model for code tasks
  private readonly model = 'gemini-2.5-flash';

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async complete(opts: AiRequestOptions): Promise<AiResponse> {
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: opts.system,
      generationConfig: {
        maxOutputTokens: opts.maxTokens,
        // Lower temperature for deterministic JSON output
        temperature: 0.2,
      },
      // Disable safety filters that may block code snippets with security content
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
      ],
    });

    const result = await model.generateContent(opts.user);
    const text = result.response.text().trim();

    this.logger.debug(
      `Gemini response: ${result.response.usageMetadata?.candidatesTokenCount ?? '?'} output tokens`,
    );
    return { text };
  }
}
