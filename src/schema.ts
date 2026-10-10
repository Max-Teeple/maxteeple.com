import schemaSql from '../migrations/0001_init.sql';

function statements(sql: string): string[] {
  const stripped = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return stripped
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Create tables if they are missing. Checked on every request so a fresh
 * database (first deploy, or an isolated test) still self-initializes.
 * Statements are idempotent (CREATE TABLE IF NOT EXISTS).
 */
export async function ensureSchema(db: D1Database): Promise<void> {
  const existing = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'courses'`)
    .first<{ name: string }>();
  if (existing) return;

  // Statement-by-statement. db.exec() trips a D1 meta bug in some local runtimes.
  for (const statement of statements(schemaSql)) {
    await db.prepare(statement).run();
  }
  await db
    .prepare(`INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0001_init', ?)`)
    .bind(new Date().toISOString())
    .run();
}
