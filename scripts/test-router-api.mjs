// Optional standalone paid connection test. The application itself uses queued company updates.
import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
const key = process.env.ROUTER_API_KEY;
if (!key) {
  console.error('Missing ROUTER_API_KEY');
  process.exit(1);
}
const provider = createOpenAICompatible({
  name: 'router',
  apiKey: key,
  baseURL: process.env.ROUTER_BASE_URL || 'https://api.router.ai/v1',
});
for (const prompt of [
  '你好，请用一句中文解释什么是自由现金流 FCF。',
  '某公司 2025 年经营现金流为 1,647 亿美元，资本开支为 914 亿美元。请计算自由现金流，并简要解释资本开支增加对自由现金流的影响。',
]) {
  const start = Date.now();
  try {
    const result = await generateText({
      model: provider.chatModel(process.env.AI_MODEL || 'gpt-6.1-sol'),
      prompt,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(60000),
    });
    console.log(
      JSON.stringify({
        model: result.response.modelId,
        content: result.text,
        usage: result.usage,
        elapsedMs: Date.now() - start,
      }).replaceAll(key, '[REDACTED]'),
    );
  } catch {
    console.error(
      'API request failed; credentials and upstream payload hidden',
    );
    process.exitCode = 1;
  }
}
