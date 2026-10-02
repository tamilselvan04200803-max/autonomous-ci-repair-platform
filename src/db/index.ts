import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl && process.env.NODE_ENV === "production") {
  console.warn("[aegis-forge] Warning: DATABASE_URL is not set in production. Database queries will fail.");
}

const globalForDb = globalThis as typeof globalThis & {
  __aegisForgePool?: Pool;
};

export const pool =
  globalForDb.__aegisForgePool ??
  new Pool({
    connectionString: databaseUrl || "postgresql://postgres:postgres@localhost:5432/postgres",
    max: Number(process.env.DATABASE_MAX_CONNECTIONS ?? "20"),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });

pool.on("error", (err) => {
  console.error("[aegis-forge] PostgreSQL idle client error:", err.message);
});

if (process.env.NODE_ENV !== "production") {
  globalForDb.__aegisForgePool = pool;
}

export const db = drizzle(pool);
