import fs from "fs";
import path from "path";
import { AutomationLog, AutomationRule, Settings } from "./types";

// Lightweight JSON-file-backed store. Runs in a single Next.js server process
// (`next start`), so synchronous file writes are safe and race-free enough for
// a self-hosted automation tool. Swap for SQLite/Postgres if you scale out.

// DATA_DIR lets cloud hosts point storage at a persistent volume so the
// token/settings/rules survive restarts and redeploys. Defaults to ./data.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const RULES_FILE = path.join(DATA_DIR, "rules.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const LOGS_FILE = path.join(DATA_DIR, "logs.json");

const MAX_LOGS = 1000;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    ensureDir();
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf-8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  ensureDir();
  // Write directly (no tmp+rename): renaming over an existing file is flaky on
  // Windows when antivirus/OneDrive briefly locks it, which could drop saves.
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

/* ----------------------------- Settings ----------------------------- */

function defaultSettings(): Settings {
  return {
    appId: process.env.TIKTOK_APP_ID ?? "",
    appSecret: process.env.TIKTOK_APP_SECRET ?? "",
    accessToken: process.env.TIKTOK_ACCESS_TOKEN ?? "",
    advertiserId: process.env.TIKTOK_ADVERTISER_ID ?? "",
    apiBase:
      process.env.TIKTOK_API_BASE ??
      "https://business-api.tiktok.com/open_api/v1.3",
    redirectUri:
      process.env.TIKTOK_REDIRECT_URI ??
      "https://chobtham.org/api/auth/callback",
    schedulerEnabled: process.env.SCHEDULER_ENABLED !== "false",
    schedulerIntervalMinutes: Number(
      process.env.SCHEDULER_INTERVAL_MINUTES ?? 15
    ),
  };
}

export function getSettings(): Settings {
  const stored = readJson<Partial<Settings> | null>(SETTINGS_FILE, null);
  return { ...defaultSettings(), ...(stored ?? {}) };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  writeJson(SETTINGS_FILE, next);
  return next;
}

/* ------------------------------ Rules ------------------------------- */

export function getRules(): AutomationRule[] {
  return readJson<AutomationRule[]>(RULES_FILE, []);
}

export function getRule(id: string): AutomationRule | undefined {
  return getRules().find((r) => r.id === id);
}

export function saveRule(rule: AutomationRule): AutomationRule {
  const rules = getRules();
  const idx = rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) rules[idx] = rule;
  else rules.push(rule);
  writeJson(RULES_FILE, rules);
  return rule;
}

export function deleteRule(id: string): boolean {
  const rules = getRules();
  const next = rules.filter((r) => r.id !== id);
  if (next.length === rules.length) return false;
  writeJson(RULES_FILE, next);
  return true;
}

/* ------------------------------- Logs ------------------------------- */

export function getLogs(limit = 200): AutomationLog[] {
  const logs = readJson<AutomationLog[]>(LOGS_FILE, []);
  return logs.slice(0, limit);
}

export function addLogs(entries: AutomationLog[]) {
  if (entries.length === 0) return;
  const existing = readJson<AutomationLog[]>(LOGS_FILE, []);
  // Newest first, capped.
  const next = [...entries, ...existing].slice(0, MAX_LOGS);
  writeJson(LOGS_FILE, next);
}

export function newId(prefix = ""): string {
  return `${prefix}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
