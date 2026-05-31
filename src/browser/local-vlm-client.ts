export interface LocalVlmRequest {
  endpoint?: string;
  model?: string;
  prompt: string;
  imageBase64: string;
  timeoutMs?: number;
}

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

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
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

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  if (!text.trim()) return {};
  return JSON.parse(text) as unknown;
}

export function getDefaultLocalVlmEndpoint(): string {
  return normalizeEndpoint(env('OPENZEROCODE_VLM_URL') ?? env('GEASS_VLM_URL') ?? DEFAULT_ENDPOINT);
}

export function getDefaultLocalVlmModel(): string {
  return env('OPENZEROCODE_VLM_MODEL') ?? env('GEASS_VLM_MODEL') ?? DEFAULT_MODEL;
}

export async function analyzeImageWithLocalVlm(request: LocalVlmRequest): Promise<LocalVlmResult> {
  const endpoint = normalizeEndpoint(request.endpoint ?? getDefaultLocalVlmEndpoint());
  const model = request.model ?? getDefaultLocalVlmModel();
  const timeoutMs = request.timeoutMs ?? Number(env('OPENZEROCODE_VLM_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
  const imageUrl = `data:image/png;base64,${request.imageBase64}`;

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

  const llamaBody = {
    prompt: `${request.prompt}\n\n[img-1]`,
    image_data: [{ data: request.imageBase64, id: 1 }],
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
