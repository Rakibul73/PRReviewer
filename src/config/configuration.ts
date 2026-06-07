import type { AiProviderName } from '../ai/providers/provider.interface';

const VALID_PROVIDERS: AiProviderName[] = ['anthropic', 'groq', 'gemini'];

function resolveProvider(): AiProviderName {
  const raw = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase().trim();
  if (VALID_PROVIDERS.includes(raw as AiProviderName)) {
    return raw as AiProviderName;
  }
  console.warn(
    `[Config] Unknown AI_PROVIDER "${raw}", falling back to "anthropic". Valid values: ${VALID_PROVIDERS.join(', ')}`,
  );
  return 'anthropic';
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  github: {
    appId: process.env.GITHUB_APP_ID!,
    privateKey: (process.env.GITHUB_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
    appName: process.env.GITHUB_APP_NAME ?? 'prreviewer-bot',
  },
  ai: {
    // Which provider to use: "anthropic" | "groq" | "gemini"
    provider: resolveProvider(),
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY ?? '',
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY ?? '',
    },
  },
});
