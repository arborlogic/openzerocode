import { execFileSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface LocalVlmRequest {
  endpoint?: string;
  model?: string;
  prompt: string;
  imageBase64: string;
  imageFormat?: 'png' | 'jpeg';
  timeoutMs?: number;
}

// Keep local VLM image payloads modest by normalizing them before they reach
// a local model. Oversized payloads are adaptively downscaled until they fit
// the target budget.
// These defaults target CPU-hosted VLMs as well as network payload size. A 896px
// browser view remains readable for UI/layout inspection while substantially
// reducing visual tokens compared with a native/high-DPI screenshot.
const DEFAULT_MAX_LONG_EDGE = 896;
const DEFAULT_MIN_LONG_EDGE = 384;
const DEFAULT_JPEG_QUALITY = 60;
const DEFAULT_MAX_BASE64_LENGTH = 250_000;

export interface LocalVlmResult {
  text: string;
  endpoint: string;
  api: 'openai-compatible' | 'llama-cpp-completion';
  model?: string;
}

const DEFAULT_ENDPOINT = 'http://10.66.66.5:8080';
const DEFAULT_MODEL = 'llava';
const DEFAULT_TIMEOUT_MS = 60_000;

function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function normalizeLocalVlmEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

function normalizeEndpoint(endpoint: string): string {
  return normalizeLocalVlmEndpoint(endpoint);
}

function cleanVlmText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';

  const lines = normalized.split('\n');
  const dedupedLines: string[] = [];
  for (const line of lines) {
    if (dedupedLines.length === 0 || dedupedLines[dedupedLines.length - 1] !== line) {
      dedupedLines.push(line);
    }
  }

  let deduped = dedupedLines.join('\n').trim();

  // Some llama.cpp vision models can loop the same sentence/block until n_predict is exhausted.
  // First collapse adjacent repeated blocks that may start before the final tail.
  const repeatedBlock = /^([\s\S]{20,}?)(?:\s*\1)+$/;
  let blockMatch = deduped.match(repeatedBlock);
  while (blockMatch?.[1] && blockMatch[1].trim() !== deduped) {
    deduped = blockMatch[1].trim();
    blockMatch = deduped.match(repeatedBlock);
  }

  const matches = deduped.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g);
  if (!matches || matches.length < 4) return deduped;

  // Then repeatedly trim duplicated trailing sentence groups.
  let sentences: string[] = [...matches];
  let changed = true;
  while (changed && sentences.length >= 4) {
    changed = false;
    for (let size = Math.floor(sentences.length / 2); size >= 1; size--) {
      const tail = sentences.slice(-size).join('').trim();
      const previous = sentences.slice(-size * 2, -size).join('').trim();
      if (tail && tail === previous) {
        sentences = sentences.slice(0, -size);
        changed = true;
        break;
      }
    }
  }

  return sentences.join('').trim();
}

function parseOpenAIResponse(data: unknown): string | undefined {
  const choices = (data as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> }).choices;
  if (!choices || choices.length === 0) return undefined;
  const content = choices[0]?.message?.content ?? choices[0]?.text;
  if (typeof content === 'string') return cleanVlmText(content);
  if (Array.isArray(content)) {
    return cleanVlmText(content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join(''));
  }
  return undefined;
}

function parseLlamaCompletionResponse(data: unknown): string | undefined {
  const content = (data as { content?: unknown; response?: unknown; text?: unknown }).content
    ?? (data as { content?: unknown; response?: unknown; text?: unknown }).response
    ?? (data as { content?: unknown; response?: unknown; text?: unknown }).text;
  return typeof content === 'string' ? cleanVlmText(content) : undefined;
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(res.status, `HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  if (!text.trim()) return {};
  return JSON.parse(text) as unknown;
}

function supportsLlamaCompletionFallback(error: unknown): boolean {
  // Do not make a second expensive vision request after a timeout, transport
  // failure, or busy/error response. /completion is only a compatibility
  // fallback for servers that do not expose the OpenAI chat route.
  return error instanceof HttpError && [404, 405, 501].includes(error.status);
}

function ffmpegJpegQuality(quality: number): string {
  // ffmpeg's MJPEG quantizer is inverted: 2 is highest quality, 31 lowest.
  return String(Math.round(2 + ((100 - quality) * 29) / 99));
}

function convertWithSips(input: string, output: string, edge: number, quality: number): void {
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), '-Z', String(edge), input, '--out', output], {
    timeout: 15_000,
    stdio: 'ignore',
  });
}

function convertWithFfmpeg(input: string, output: string, edge: number, quality: number): void {
  // -2 preserves aspect ratio and guarantees even output dimensions, which
  // avoids encoder failures for screenshots with odd pixel dimensions.
  const scale = `scale='if(gte(iw,ih),${edge},-2)':'if(gte(ih,iw),${edge},-2)'`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-vf', scale, '-frames:v', '1', '-q:v', ffmpegJpegQuality(quality), output], {
    timeout: 15_000,
    stdio: 'ignore',
  });
}

function convertToJpeg(input: string, output: string, edge: number, quality: number): void {
  try {
    convertWithSips(input, output, edge, quality);
  } catch {
    // sips is only available on macOS. ffmpeg is widely available on Linux,
    // Windows, and macOS, so use it whenever sips is absent or rejects input.
    convertWithFfmpeg(input, output, edge, quality);
  }
}

export function getDefaultLocalVlmEndpoint(): string {
  return normalizeEndpoint(env('OPENZEROCODE_VLM_URL') ?? env('GEASS_VLM_URL') ?? DEFAULT_ENDPOINT);
}

export function getDefaultLocalVlmModel(): string {
  return env('OPENZEROCODE_VLM_MODEL') ?? env('GEASS_VLM_MODEL') ?? DEFAULT_MODEL;
}

export function setProcessLocalVlmConfig(config: { endpoint?: string | null; model?: string | null; force?: boolean | null }) {
  const endpoint = config.endpoint?.trim();
  const model = config.model?.trim();
  if (endpoint) process.env.OPENZEROCODE_VLM_URL = normalizeEndpoint(endpoint);
  else delete process.env.OPENZEROCODE_VLM_URL;
  if (model) process.env.OPENZEROCODE_VLM_MODEL = model;
  else delete process.env.OPENZEROCODE_VLM_MODEL;
  if (config.force === true) process.env.OPENZEROCODE_FORCE_LOCAL_VLM = '1';
  else if (config.force === false) delete process.env.OPENZEROCODE_FORCE_LOCAL_VLM;
}

export function shouldForceLocalVlm(): boolean {
  const value = env('OPENZEROCODE_FORCE_LOCAL_VLM')?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/**
 * Prepare a base64-encoded image for llama.cpp VLM APIs.
 *
 * Always normalize screenshots to the configured JPEG dimensions/quality before
 * they reach a local VLM. This caps visual-token work even when a source image
 * happens to compress below the byte budget. Then progressively shrink further
 * when needed to fit that budget.
 */
export function prepareVlmImage(base64: string, inputFormat: 'png' | 'jpeg'): { base64: string; format: 'jpeg' | 'png' } {
  const maxLongEdge = clampInt(env('OPENZEROCODE_VLM_IMAGE_MAX_LONG_EDGE'), DEFAULT_MAX_LONG_EDGE, 64, 4096);
  const minLongEdge = clampInt(env('OPENZEROCODE_VLM_IMAGE_MIN_LONG_EDGE'), DEFAULT_MIN_LONG_EDGE, 64, maxLongEdge);
  const jpegQuality = clampInt(env('OPENZEROCODE_VLM_IMAGE_QUALITY'), DEFAULT_JPEG_QUALITY, 1, 100);
  const maxBase64Length = clampInt(env('OPENZEROCODE_VLM_MAX_BASE64_LENGTH'), DEFAULT_MAX_BASE64_LENGTH, 16_000, 5_000_000);

  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpIn = join(tmpdir(), `vlm-resize-in-${stamp}`);
  const tmpOut = join(tmpdir(), `vlm-resize-out-${stamp}.jpg`);

  try {
    writeFileSync(tmpIn, Buffer.from(base64, 'base64'));

    const edgeCandidates = Array.from(new Set([
      maxLongEdge,
      Math.round(maxLongEdge * 0.75),
      Math.round(maxLongEdge * 0.5),
      minLongEdge,
    ]))
      .filter((edge) => edge >= minLongEdge && edge <= maxLongEdge)
      .sort((a, b) => b - a);
    const qualityCandidates = Array.from(new Set([jpegQuality, 50, 40, 30, 20]))
      .map((quality) => Math.min(jpegQuality, quality))
      .filter((quality) => quality >= 1 && quality <= 100);

    let best: { base64: string; format: 'jpeg' } | undefined;
    for (const edge of edgeCandidates) {
      for (const quality of qualityCandidates) {
        convertToJpeg(tmpIn, tmpOut, edge, quality);
        const converted = readFileSync(tmpOut).toString('base64');
        if (!best || converted.length < best.base64.length) {
          best = { base64: converted, format: 'jpeg' };
        }
        if (converted.length <= maxBase64Length) {
          return best;
        }
      }
    }

    return best ?? { base64, format: inputFormat };
  } catch {
    // Fall back to the original payload. This keeps non-macOS environments usable
    // when `sips` is unavailable; callers may still point to a stronger VLM.
  } finally {
    for (const file of [tmpIn, tmpOut]) {
      try { unlinkSync(file); } catch { /* ignore */ }
    }
  }

  return { base64, format: inputFormat };
}

export async function analyzeImageWithLocalVlm(request: LocalVlmRequest): Promise<LocalVlmResult> {
  const endpoint = normalizeEndpoint(request.endpoint ?? getDefaultLocalVlmEndpoint());
  const model = request.model ?? getDefaultLocalVlmModel();
  const timeoutMs = request.timeoutMs ?? Number(env('OPENZEROCODE_VLM_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
  const inputFormat = request.imageFormat ?? 'png';
  const preparedImage = prepareVlmImage(request.imageBase64, inputFormat);
  const imageBase64 = preparedImage.base64;
  const mimeType = preparedImage.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const imageUrl = `data:${mimeType};base64,${imageBase64}`;

  const openAiBody = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: request.prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 220,
    stop: ['\n\n\n', '<|im_end|>', '</s>', 'User:', 'Assistant:'],
  };

  let openAiError: unknown;
  try {
    const data = await postJson(`${endpoint}/v1/chat/completions`, openAiBody, timeoutMs);
    const text = parseOpenAIResponse(data);
    if (text) return { text, endpoint, api: 'openai-compatible', model };
    openAiError = new Error('OpenAI-compatible response did not contain text content');
  } catch (error) {
    openAiError = error;
  }

  if (!supportsLlamaCompletionFallback(openAiError)) {
    const message = openAiError instanceof Error ? openAiError.message : String(openAiError);
    throw new Error(`Local VLM analysis failed through the OpenAI-compatible API: ${message}`);
  }

  const llamaBody = {
    prompt: `${request.prompt}\n\n[img-1]`,
    image_data: [{ data: imageBase64, id: 1 }],
    temperature: 0,
    n_predict: 220,
    stop: ['\n\n\n', '<|im_end|>', '</s>', 'User:', 'Assistant:'],
  };

  try {
    const data = await postJson(`${endpoint}/completion`, llamaBody, timeoutMs);
    const text = parseLlamaCompletionResponse(data);
    if (text) return { text, endpoint, api: 'llama-cpp-completion', model };
    throw new Error('llama.cpp completion response did not contain text content');
  } catch (llamaError) {
    const openAiMessage = openAiError instanceof Error ? openAiError.message : String(openAiError);
    const llamaMessage = llamaError instanceof Error ? llamaError.message : String(llamaError);
    throw new Error(`Local VLM analysis failed. OpenAI-compatible error: ${openAiMessage}; llama.cpp /completion error: ${llamaMessage}`);
  }
}
