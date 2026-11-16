import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { classifyTask } from '../lib/server/provider';
test('provider adapter redacts identifiers, validates responses and rejects unsafe recommendations', async () => {
  let mode = 'good';
  let body: any;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    body = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json');
    if (mode === '429') {
      res.statusCode = 429;
      return res.end('{}');
    }
    const content =
      mode === 'malformed'
        ? 'not json'
        : mode === 'unsafe'
          ? JSON.stringify({
              category: 'assist',
              confidence: 'high',
              rationale: 'You should fire employees to improve margins.',
            })
          : JSON.stringify({
              category: 'assist',
              confidence: 'high',
              rationale: 'Draft test cases with human review of correctness.',
            });
    res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 50 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  process.env.OPENAI_API_KEY = 'synthetic-key';
  process.env.OPENAI_MODEL = 'synthetic-model';
  process.env.AI_DATA_PROCESSING_APPROVED = 'true';
  try {
    const result = await classifyTask('Discuss tests with alex@example.com for EMP-123.');
    assert.equal(result.confidence, 'uncalibrated');
    assert.equal(result.model, 'synthetic-model');
    assert.ok(!body.messages[1].content.includes('alex@example.com'));
    assert.ok(!body.messages[1].content.includes('EMP-123'));
    assert.equal(body.tools, undefined);
    mode = 'malformed';
    await assert.rejects(() => classifyTask('Test cases'));
    mode = 'unsafe';
    await assert.rejects(() => classifyTask('Test cases'));
    mode = '429';
    await assert.rejects(() => classifyTask('Test cases'), /rate limit/);
    delete process.env.AI_DATA_PROCESSING_APPROVED;
    assert.equal((await classifyTask('Do not transmit this task.')).model, 'manual-review');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.AI_DATA_PROCESSING_APPROVED;
  }
});
