import { createRequire } from 'node:module';
import {
  detectOnce,
  headersFor,
  userAgentSuffix,
} from '@superfly/client-signals';

const DISABLE_VALUES = new Set(['0', 'off', 'false', 'no', 'disabled']);
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

/** Return a fresh copy of process-wide client-signal headers. */
export function signalHeaders(): Record<string, string> {
  cachedHeaders ??= computeHeaders();
  return { ...cachedHeaders };
}

/** @internal */
export function resetSignalHeadersForTest(): void {
  cachedHeaders = undefined;
}
