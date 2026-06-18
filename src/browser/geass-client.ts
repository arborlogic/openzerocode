const DEFAULT_PORT = 9876;
const BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

const env = (key: string): string | undefined =>
  typeof process !== 'undefined' ? process.env[key] : undefined;

const configuredSessionId = (): string | undefined => {
  const value = env('OPENZEROCODE_GEASS_SESSION_ID') ?? env('GEASS_SESSION_ID');
  const trimmed = value?.trim();
  return trimmed && trimmed !== 'default' ? trimmed : undefined;
};

const apiPath = (path: string): string => {
  const sessionId = configuredSessionId();
  const normalizedPath = path.replace(/^\/+/, '');
  return sessionId ? `sessions/${encodeURIComponent(sessionId)}/${normalizedPath}` : normalizedPath;
};

let _enabled: boolean = false;
let _connected: boolean = false;

export interface PageSnapshot {
  url: string;
  title: string;
  headings: string[];
  visibleTextSummary: string[];
  authFlow?: {
    kind: string;
    confidence: number;
    signals: string[];
    passwordFieldCount: number;
    otpFieldCount: number;
    passkeyHints: string[];
  };
  structured?: {
    elements: Array<{
      id: string;
      role: string;
      text?: string;
      label?: string;
      type?: string;
      placeholder?: string;
      ariaLabel?: string;
      selectorHint?: string;
      visible: boolean;
      inViewport: boolean;
    }>;
    tables: Array<{
      id: string;
      headers: string[];
      sampleRows?: string[][];
    }>;
  };
  capturedAt: number;
}

export interface ScreenshotResult {
  base64: string;
  format?: 'png' | 'jpeg';
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
  resized?: boolean;
  quality?: number;
  viewport?: {
    x: number;
    y: number;
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
  url?: string;
  title?: string;
  capturedAt?: number;
}

export interface ScreenshotOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxLongEdge?: number;
}

export interface VisualObservationOptions {
  screenshot?: ScreenshotOptions;
}

export interface VisualObservation {
  screenshot: ScreenshotResult;
  page: PageSnapshot;
}

export interface VlmSettings {
  enabled: boolean;
  endpoint: string;
  model: string;
  timeoutMs: number;
}

export interface ActionResult {
  ok: boolean;
  detail: string;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}/${apiPath(path)}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`GEASS API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Ping GEASS Desktop's health endpoint. Returns true if reachable. */
export async function testConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) {
      _connected = false;
      return false;
    }
    const data = (await res.json()) as { browserReady?: boolean };
    _connected = data.browserReady !== false;
    return _connected;
  } catch {
    _connected = false;
    return false;
  }
}

/** Is the GEASS feature enabled by the user? */
export function isEnabled(): boolean {
  return _enabled;
}

export function setEnabled(v: boolean): void {
  _enabled = v;
  if (!v) _connected = false;
}

/** Is GEASS Desktop actually connected AND enabled? */
export function isConnected(): boolean {
  return _enabled && _connected;
}

// -- Browser operations (call these only after isConnected() === true) --

export async function navigate(url: string): Promise<{ ok: boolean; tab?: unknown }> {
  return request('POST', 'navigate', { url });
}

export async function readPage(): Promise<PageSnapshot> {
  return request('GET', 'page');
}

export async function click(args: { targetLabel?: string; selectorHint?: string }): Promise<ActionResult> {
  return request('POST', 'click', args);
}

export async function typeText(args: { targetLabel?: string; selectorHint?: string; text: string }): Promise<ActionResult> {
  return request('POST', 'type', args);
}

export async function selectOption(args: { targetLabel?: string; selectorHint?: string; value: string }): Promise<ActionResult> {
  return request('POST', 'select', args);
}

export async function scroll(args: { direction?: 'up' | 'down' | 'top' | 'bottom'; amount?: number }): Promise<ActionResult> {
  return request('POST', 'scroll', args);
}

export async function pressKey(args: { key?: string }): Promise<ActionResult> {
  return request('POST', 'press', args);
}

export async function screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
  return request('POST', 'screenshot', options ?? {});
}

export async function observeVisual(options?: VisualObservationOptions): Promise<VisualObservation> {
  return request('POST', 'observe-visual', options ?? {});
}

export async function getVlmSettings(): Promise<VlmSettings> {
  return request('GET', 'vlm-settings');
}
