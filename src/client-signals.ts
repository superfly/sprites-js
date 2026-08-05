import { createRequire } from 'node:module';
import {
  detectOnce,
  headersFor,
  userAgentSuffix,
} from '@fly/client-signals';

const DISABLE_VALUES = new Set(['0', 'off', 'false', 'no', 'disabled']);
// package.json sits outside rootDir, so it cannot be imported. Bundlers that
// drop package.json from their output will need to shim this read.
const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

let cachedHeaders: Readonly<Record<string, string>> | undefined;

function disabled(): boolean {
  return DISABLE_VALUES.has(
    (process.env.SPRITES_CLIENT_SIGNALS ?? '').trim().toLowerCase()
  );
}

function computeHeaders(): Readonly<Record<string, string>> {
  const userAgent = `sprites-js/${version}`;
  if (disabled()) return { 'User-Agent': userAgent };

  const signals = detectOnce();
  return {
    ...headersFor(signals),
    'User-Agent': `${userAgent} ${userAgentSuffix(signals)}`,
  };
}

/**
 * Return a fresh copy of process-wide client-signal headers.
 *
 * Signals and the SPRITES_CLIENT_SIGNALS opt-out are read once, on the first
 * call, and reused for the life of the process.
 */
export function signalHeaders(): Record<string, string> {
  cachedHeaders ??= computeHeaders();
  return { ...cachedHeaders };
}

/**
 * Build the headers for an authenticated Sprites request: client signals,
 * bearer authorization, and any request-specific extras.
 *
 * Every authenticated REST call and WebSocket handshake in the SDK goes
 * through this so attribution cannot be missed at a new call site.
 */
export function authHeaders(
  token: string,
  extra?: Record<string, string>
): Record<string, string> {
  return {
    ...signalHeaders(),
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

/** @internal */
export function resetSignalHeadersForTest(): void {
  cachedHeaders = undefined;
}
