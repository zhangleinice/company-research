/* eslint-disable @typescript-eslint/no-require-imports -- Offline SDK integration test with a simulated fetch. */
/* global require, global, Response, console, process */
// Uses the real Vercel AI SDK with a simulated fetch: never sends network requests.
const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const {
  SummaryModel,
  BUSINESS_SYSTEM_PROMPT,
} = require('../apps/api/dist/modules/ai-research/summary-model');
const {
  TOPICS,
} = require('../apps/api/dist/modules/ai-research/summary-schema');
const summary = {
  groups: TOPICS.business.map((topic, i) => ({
    topic,
    findings:
      i === 0
        ? [
            {
              kind: '公司披露的事实',
              businessName: 'Enterprise Services',
              text: '向企业提供订阅软件服务。',
              evidence: [
                {
                  paragraphId: 'Item 1:p1',
                  quote:
                    'Enterprise Services provides subscription software to business customers.',
                },
              ],
            },
          ]
        : [],
  })),
};
const original = global.fetch;
let requests = 0;
global.fetch = async (url, init) => {
  requests++;
  assert.equal(String(url), 'https://api.router.ai/v1/chat/completions');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.messages[0].content, BUSINESS_SYSTEM_PROMPT);
  assert.equal(summary.groups.length, 3);
  return new Response(
    JSON.stringify({
      id: 'fixture',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-6.1-sol',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: JSON.stringify(summary) },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 9, completion_tokens: 10, total_tokens: 19 },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
new SummaryModel(
  new ConfigService({
    ROUTER_API_KEY: 'test-fixture-not-a-real-key',
    ROUTER_BASE_URL: 'https://api.router.ai/v1',
    AI_MODEL: 'gpt-6.1-sol',
    AI_ITEM_LIMITS_JSON: JSON.stringify({model:'gpt-6.1-sol',provider:'https://api.router.ai/v1',contextWindow:128000,maxInputTokens:64000,maxOutputTokens:32000,byteFallbackTokenizer:true,source:'Offline mocked service limits'}),
  }),
)
  .generate(
    'business',
    [
      {
        id: 'Item 1:p1',
        text: 'Enterprise Services provides subscription software to business customers.',
      },
    ],
    async () => {},
  )
  .then((result) => {
    assert.deepEqual(result.summary, summary);
    assert.equal(result.usage.calls, 1);
    assert.equal(result.usage.inputTokens, 9);
    assert.equal(result.usage.outputTokens, 10);
    assert.equal(requests, 1);
    console.log(
      'PASS: Vercel SDK compatible JSON request, grounded output, model and token usage; no real requests.',
    );
  })
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = original;
  });
