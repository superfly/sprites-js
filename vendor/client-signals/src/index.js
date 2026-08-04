import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_HEADER_PREFIX = "Fly";

const MAX_INVOKED_BY_LEN = 64;
const INVOKED_BY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const KNOWN_MARKERS = [
  { agent: "claude-code", env: "CLAUDECODE", kind: "exactValue", values: ["1"] },
  { agent: "claude-code", env: "CLAUDE_CODE_ENTRYPOINT", kind: "presence" },
  { agent: "pi", env: "PI_CODING_AGENT", kind: "exactValue", values: ["true"] },
  { agent: "openclaw", env: "OPENCLAW_SHELL", kind: "exactValue", values: ["exec"] },
  { agent: "openclaw", env: "OPENCLAW_CLI", kind: "exactValue", values: ["1"] },
  { agent: "goose", env: "GOOSE_TERMINAL", kind: "exactValue", values: ["1"] },
  { agent: "hermes", env: "HERMES_SESSION_ID", kind: "presence" },
  { agent: "codex", env: "CODEX_SANDBOX", kind: "presence" },
  { agent: "codex", env: "CODEX_THREAD_ID", kind: "presence" },
  { agent: "cursor", env: "CURSOR_TRACE_ID", kind: "presence" },
  { agent: "cursor", env: "CURSOR_AGENT", kind: "presence" },
  { agent: "gemini-cli", env: "GEMINI_CLI", kind: "presence" },
  { agent: "kiro", env: "TERM_PROGRAM", kind: "exactValue", values: ["kiro"] },
  { agent: "antigravity", env: "ANTIGRAVITY_AGENT", kind: "presence" },
  { agent: "augment", env: "AUGMENT_AGENT", kind: "presence" },
  { agent: "replit", env: "REPL_ID", kind: "presence" },
  { agent: "opencode", env: "OPENCODE", kind: "presence" },
  { agent: "opencode", env: "OPENCODE_CALLER", kind: "presence" },
  { agent: "opencode", env: "OPENCODE_CLIENT", kind: "presence" },
  { agent: "copilot", env: "COPILOT_MODEL", kind: "presence" },
  { agent: "copilot", env: "COPILOT_ALLOW_ALL", kind: "presence" },
  { agent: "kilo-code", env: "KILO_PLATFORM", kind: "exactValue", values: ["vscode"] },
];

let cachedSignals;

export function detect() {
  const [agent, agentSource] = detectAgent();
  return {
    interactive: isInteractive(),
    parent: parentBucket(),
    agent,
    agentSource,
    ci: isCI(),
  };
}

export function detectOnce() {
  if (cachedSignals === undefined) {
    cachedSignals = detect();
  }
  return cachedSignals;
}

export function resetCachedForTest() {
  cachedSignals = undefined;
}

export function headersFor(signals, prefix = DEFAULT_HEADER_PREFIX) {
  const headers = {
    [`${prefix}-Client-Interactive`]: String(Boolean(signals.interactive)),
    [`${prefix}-Client-Parent`]: signals.parent,
  };
  if (signals.agent) {
    headers[`${prefix}-Client-Agent`] = signals.agent;
    headers[`${prefix}-Client-Agent-Source`] = signals.agentSource;
  }
  if (signals.ci) {
    headers[`${prefix}-Client-CI`] = "true";
  }
  return headers;
}

export function applyHeaders(target, signals, prefix = DEFAULT_HEADER_PREFIX) {
  for (const [name, value] of Object.entries(headersFor(signals, prefix))) {
    if (typeof target.set === "function") {
      target.set(name, value);
    } else if (typeof target.setHeader === "function") {
      target.setHeader(name, value);
    } else {
      target[name] = value;
    }
  }
  return target;
}

export function userAgentSuffix(signals) {
  let suffix = `interactive=${Boolean(signals.interactive)}; parent=${signals.parent}`;
  if (signals.agent) {
    suffix += `; agent=${signals.agent}`;
  }
  return `(${suffix})`;
}

// operator returns one process-operator classification. Precedence is
// ci > agent > interactive > unknown.
export function operator(signals) {
  if (signals.ci) {
    return "ci";
  }
  if (signals.agent) {
    return "agent";
  }
  if (signals.interactive) {
    return "interactive";
  }
  return "unknown";
}

export function sanitizeInvokedBy(value) {
  const sanitized = String(value).trim().toLowerCase();
  if (sanitized.length === 0 || sanitized.length > MAX_INVOKED_BY_LEN) {
    return [undefined, false];
  }
  if (!INVOKED_BY_PATTERN.test(sanitized)) {
    return [undefined, false];
  }
  return [sanitized, true];
}

export function classifyParentName(raw) {
  let name = basename(String(raw).toLowerCase());
  if (name.endsWith(".exe")) {
    name = name.slice(0, -4);
  }

  if (name === "node") {
    return "node";
  }
  if (name === "python" || name === "python3" || name === "python2") {
    return "python";
  }
  if (["bash", "zsh", "fish", "sh", "dash", "ksh", "tcsh", "csh", "cmd", "powershell", "pwsh"].includes(name)) {
    return "shell";
  }
  return "other";
}

function detectAgent() {
  if (hasEnv("FLY_INVOKED_BY")) {
    const [agent, ok] = sanitizeInvokedBy(process.env.FLY_INVOKED_BY);
    if (ok) {
      return [agent, "env:FLY_INVOKED_BY"];
    }
  }

  for (const marker of KNOWN_MARKERS) {
    if (!hasEnv(marker.env)) {
      continue;
    }
    if (marker.kind === "presence") {
      return [marker.agent, `env:${marker.env}`];
    }
    if (marker.values.includes(process.env[marker.env])) {
      return [marker.agent, `env:${marker.env}`];
    }
  }

  if (hasEnv("AGENT")) {
    const [agent, ok] = sanitizeInvokedBy(process.env.AGENT);
    if (ok) {
      return [agent, "env:AGENT"];
    }
  }

  return ["", ""];
}

function isInteractive() {
  return Boolean(process.stdout?.isTTY);
}

function isCI() {
  return hasEnv("CI") || hasEnv("GITHUB_ACTIONS");
}

function parentBucket() {
  return classifyParentName(lookupParentName(process.ppid));
}

function lookupParentName(ppid) {
  if (process.platform === "linux") {
    try {
      return readFileSync(`/proc/${ppid}/comm`, "utf8").trim();
    } catch {
      return "";
    }
  }
  return "";
}

function hasEnv(name) {
  return Object.prototype.hasOwnProperty.call(process.env, name);
}

export function loadJSONFixture(path) {
  return JSON.parse(readFileSync(fileURLToPath(path), "utf8"));
}

export function isInteractiveFileForTest(path) {
  try {
    return statSync(path).isCharacterDevice();
  } catch {
    return false;
  }
}
