import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { analyzeImageWithLocalVlm, prepareVlmImage } from './local-vlm-client'

const hasSips = spawnSync('sips', ['--help'], { stdio: 'ignore' }).status === 0

const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }

afterEach(() => {
  globalThis.fetch = originalFetch
  process.env = { ...originalEnv }
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

  it('keeps images within the configured VLM payload budget unchanged', () => {
    process.env.OPENZEROCODE_VLM_MAX_BASE64_LENGTH = '100'

    const result = prepareVlmImage('abc123', 'png')

    assert.deepEqual(result, { base64: 'abc123', format: 'png' })
  })

  it('adaptively resizes oversized VLM image payloads when possible', { skip: !hasSips }, () => {
    process.env.OPENZEROCODE_VLM_MAX_BASE64_LENGTH = '16000'
    process.env.OPENZEROCODE_VLM_IMAGE_MAX_LONG_EDGE = '640'
    process.env.OPENZEROCODE_VLM_IMAGE_MIN_LONG_EDGE = '320'

    const ppmHeader = 'P6\n1200 800\n255\n'
    const pixels = Buffer.alloc(1200 * 800 * 3, 200)
    const oversized = Buffer.concat([Buffer.from(ppmHeader, 'ascii'), pixels]).toString('base64')

    const result = prepareVlmImage(oversized, 'png')

    assert.equal(result.format, 'jpeg')
    assert.ok(result.base64.length < oversized.length)
    assert.ok(result.base64.length <= 16000)
  })
})
