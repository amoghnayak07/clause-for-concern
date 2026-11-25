import { z } from "zod";

/**
 * Environment configuration. The only place env vars are read.
 *
 * Next.js loads `.env` itself; the eval CLI must load it (dotenv) before
 * calling `getConfig()`.
 */

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string({ error: "is missing" })
    .trim()
    .min(1, { error: "is empty" }),
  REVIEW_MODEL: z
    .string({ error: "is missing" })
    .trim()
    .min(1, { error: "is empty" }),
});

export interface AppConfig {
  readonly anthropicApiKey: string;
  readonly reviewModel: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function parseConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")} ${issue.message}`)
      .join("\n");
    throw new ConfigError(
      `Invalid environment configuration:\n${problems}\n` +
        "Copy .env.example to .env and fill in every value.",
    );
  }
  return {
    anthropicApiKey: result.data.ANTHROPIC_API_KEY,
    reviewModel: result.data.REVIEW_MODEL,
  };
}

let cached: AppConfig | undefined;

/** Validated config, parsed once from `process.env`. Throws `ConfigError` on any problem. */
export function getConfig(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}
