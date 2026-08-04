export type ParentBucket = "node" | "python" | "shell" | "other";

export interface Signals {
  interactive: boolean;
  parent: ParentBucket;
  agent: string;
  agentSource: string;
  ci: boolean;
}

export function detectOnce(): Signals;
export function resetCachedForTest(): void;
export function headersFor(
  signals: Signals,
  prefix?: string,
): Record<string, string>;
export function userAgentSuffix(signals: Signals): string;
