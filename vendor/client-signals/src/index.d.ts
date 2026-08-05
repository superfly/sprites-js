export type ParentBucket = "node" | "python" | "shell" | "other";
export type Operator = "ci" | "agent" | "interactive" | "unknown";

export interface Signals {
  interactive: boolean;
  parent: ParentBucket;
  agent: string;
  agentSource: string;
  ci: boolean;
}

export interface AgentMarker {
  agent: string;
  env: string;
  kind: "presence" | "exactValue";
  values?: readonly string[];
}

export interface SetHeaderTarget {
  setHeader(name: string, value: string): unknown;
}

export interface SetTarget {
  set(name: string, value: string): unknown;
}

export const DEFAULT_HEADER_PREFIX: "Fly";
export const KNOWN_MARKERS: readonly AgentMarker[];

export function detect(): Signals;
export function detectOnce(): Signals;
export function resetCachedForTest(): void;
export function headersFor(
  signals: Signals,
  prefix?: string,
): Record<string, string>;
export function applyHeaders<T extends SetHeaderTarget | SetTarget | Record<string, string>>(
  target: T,
  signals: Signals,
  prefix?: string,
): T;
export function userAgentSuffix(signals: Signals): string;
export function operator(signals: Signals): Operator;
export function sanitizeInvokedBy(value: unknown): [string | undefined, boolean];
export function classifyParentName(raw: unknown): ParentBucket;
export function loadJSONFixture(path: URL): unknown;
export function isInteractiveFileForTest(path: string | URL): boolean;
