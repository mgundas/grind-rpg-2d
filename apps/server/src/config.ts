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
  /** Dev-only artificial latency (applied in both directions by the transport). */
  SIMULATE_LATENCY_MS: z.coerce.number().int().min(0).max(5000).default(0),

  POSTGRES_HOST: z.string().min(1).default("localhost"),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_USER: z.string().min(1).default("jade"),
  POSTGRES_PASSWORD: z.string().default("jade_dev"),
  POSTGRES_DB: z.string().min(1).default("jade_throne"),
  /** Optional explicit override of the URL built from the values above. */
  DATABASE_URL: z.string().url().optional(),

  JWT_ACCESS_SECRET: z.string().min(1).default("dev-only-jade-throne-access-secret-change-me"),
  JWT_REFRESH_SECRET: z.string().min(1).default("dev-only-jade-throne-refresh-secret-change-me"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .max(365 * 24 * 3600)
    .default(30 * 24 * 3600),
  SEED_ADMIN_EMAIL: z.string().default("admin@example.com"),
  SEED_ADMIN_PASSWORD: z.string().default("change-me-please-8-chars"),
  SEED_TEST_EMAIL: z.string().default("test@example.com"),
  SEED_TEST_USERNAME: z.string().default("TestPlayer"),
  SEED_TEST_PASSWORD: z.string().default("test-password-123"),
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
  simulateLatencyMs: number;
  databaseUrl: string;
  /** True when a dev placeholder POSTGRES_PASSWORD is configured. */
  usingDefaultDbPassword: boolean;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessTtlSeconds: number;
  jwtRefreshTtlSeconds: number;
  seedAdminEmail: string;
  seedAdminPassword: string;
  seedTestEmail: string;
  seedTestUsername: string;
  seedTestPassword: string;
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
    simulateLatencyMs: env.SIMULATE_LATENCY_MS,
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
    jwtAccessSecret: env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
    jwtAccessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
    jwtRefreshTtlSeconds: env.JWT_REFRESH_TTL_SECONDS,
    seedAdminEmail: env.SEED_ADMIN_EMAIL,
    seedAdminPassword: env.SEED_ADMIN_PASSWORD,
    seedTestEmail: env.SEED_TEST_EMAIL,
    seedTestUsername: env.SEED_TEST_USERNAME,
    seedTestPassword: env.SEED_TEST_PASSWORD,
  };
}

export const config = parseConfig();
