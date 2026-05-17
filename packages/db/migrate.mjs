#!/usr/bin/env node
// Migration runner. Applies every .sql file in ./migrations/ in lexical order
// against $DATABASE_URL. Stops on the first failure (psql -v ON_ERROR_STOP=1).
//
// Invoked as: `node --env-file=.env packages/db/migrate.mjs` so .env is loaded
// before this script reads process.env.DATABASE_URL.

import { readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "  - Make sure .env exists at the repo root and contains DATABASE_URL=...\n" +
      "  - Make sure your Node version is >= 20.6 (for --env-file support).",
  );
  process.exit(1);
}

if (!existsSync(migrationsDir)) {
  console.error(`Migrations directory not found: ${migrationsDir}`);
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error("No .sql files found in", migrationsDir);
  process.exit(1);
}

for (const f of files) {
  process.stdout.write(`\n>>> Applying ${f}\n`);
  const result = spawnSync(
    "psql",
    [
      process.env.DATABASE_URL,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      join(migrationsDir, f),
    ],
    { stdio: "inherit" },
  );
  if (result.error) {
    console.error(`Failed to spawn psql: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Migration ${f} failed (psql exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nAll migrations applied.");
