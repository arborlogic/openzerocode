import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert'
import { analyzeImageWithLocalVlm } from './local-vlm-client'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('local VLM client', () => {
  it('uses OpenAI-compatible chat completions when available', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input))
      return response({ choices: [{ message: { content: 'visual description' } }] })
    }) as typeof fetch

    const result = await analyzeImageWithLocalVlm({
      endpoint: 'http://vlm.local/',
      model: 'vision-model',
      prompt: 'describe',
      imageBase64: 'abc123',
      timeoutMs: 1000,
    })

    assert.equal(result.text, 'visual description')
    assert.equal(result.endpoint, 'http://vlm.local')
    assert.equal(result.api, 'openai-compatible')
    assert.equal(result.model, 'vision-model')
    assert.deepEqual(calls, ['http://vlm.local/v1/chat/completions'])
  })

  it('deduplicates repeated VLM output blocks', async () => {
    globalThis.fetch = (async () => response({
      choices: [{
        message: {
          content: 'The page shows a social feed. It has a composer. The page shows a social feed. It has a composer. The page shows a social feed. It has a composer.',
        },
      }],
    })) as unknown as typeof fetch

    const result = await analyzeImageWithLocalVlm({
      endpoint: 'http://vlm.local/',
      model: 'vision-model',
      prompt: 'describe',
      imageBase64: 'abc123',
      timeoutMs: 1000,
    })

    assert.equal(result.text, 'The page shows a social feed. It has a composer.')
  })

  it('falls back to llama.cpp /completion when chat completions fail', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/v1/chat/completions')) {
        return new Response('not found', { status: 404 })
      }
      return response({ content: 'llama visual description' })
    }) as typeof fetch

    const result = await analyzeImageWithLocalVlm({
      endpoint: 'http://vlm.local',
      prompt: 'describe',
      imageBase64: 'abc123',
      timeoutMs: 1000,
    })

    assert.equal(result.text, 'llama visual description')
    assert.equal(result.api, 'llama-cpp-completion')
    assert.deepEqual(calls, [
      'http://vlm.local/v1/chat/completions',
      'http://vlm.local/completion',
    ])
  })
})
