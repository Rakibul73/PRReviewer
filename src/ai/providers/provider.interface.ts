export type AiProviderName = 'anthropic' | 'groq' | 'gemini';

export interface AiRequestOptions {
  system: string;
  user: string;
  maxTokens: number;
}

export interface AiResponse {
  text: string;
}

export interface AiProvider {
  readonly name: AiProviderName;
  complete(opts: AiRequestOptions): Promise<AiResponse>;
}
