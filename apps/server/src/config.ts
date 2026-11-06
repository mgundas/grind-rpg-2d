import { z } from "zod";
import { DEFAULT_SERVER_PORT } from "@jadethrone/shared";

/**
 * Server configuration, validated with Zod. The service never reads
 * `process.env` anywhere else — everything comes from here.
 *
 * Dev defaults exist so the server boots with no `.env` file, but the
 * deployment secrets live in `.env` (never committed; see `/.env.example`).
 */
const envSchema = z.object({
  GAME_SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_SERVER_PORT),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  POSTGRES_HOST: z.string().min(1).default("localhost"),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_USER: z.string().min(1).default("jade"),
  POSTGRES_PASSWORD: z.string().default("jade_dev"),
  POSTGRES_DB: z.string().min(1).default("jade_throne"),
  /** Optional explicit override of the URL built from the values above. */
  DATABASE_URL: z.string().url().optional(),
});

/**
 * Passwords that indicate a dev-only setup (unset → built-in default, empty,
 * or the documented placeholder from .env.example) — the boot log warns for
 * all of them so a deployed copy never runs with an obvious credential.
 */
const DEFAULT_DB_PASSWORDS = new Set(["", "jade_dev", "change-me-dev-only"]);

export interface Config {
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  databaseUrl: string;
  /** True when a dev placeholder POSTGRES_PASSWORD is configured. */
  usingDefaultDbPassword: boolean;
}

function buildDatabaseUrl(parts: {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}): string {
  const user = encodeURIComponent(parts.user);
  const password = encodeURIComponent(parts.password);
  return `postgres://${user}:${password}@${parts.host}:${parts.port}/${parts.database}`;
}

function parseConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  return {
    port: env.GAME_SERVER_PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl:
      env.DATABASE_URL ??
      buildDatabaseUrl({
        user: env.POSTGRES_USER,
        password: env.POSTGRES_PASSWORD,
        host: env.POSTGRES_HOST,
        port: env.POSTGRES_PORT,
        database: env.POSTGRES_DB,
      }),
    usingDefaultDbPassword:
      env.DATABASE_URL === undefined && DEFAULT_DB_PASSWORDS.has(env.POSTGRES_PASSWORD),
  };
}

export const config = parseConfig();
