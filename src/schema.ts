import schemaSql from '../migrations/0001_init.sql';
import extraSql from '../migrations/0002_liveview.sql';

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
 * Create tables if they are missing, then apply additive migrations.
 * Checked on every request so a fresh database still self-initializes.
 */
export async function ensureSchema(db: D1Database): Promise<void> {
  const existing = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'courses'`)
    .first<{ name: string }>();
  if (!existing) {
    for (const statement of statements(schemaSql)) {
      await db.prepare(statement).run();
    }
    await db
      .prepare(`INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0001_init', ?)`)
      .bind(new Date().toISOString())
      .run();
  }

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`
    )
    .run();

  const applied = await db
    .prepare(`SELECT id FROM schema_migrations WHERE id = '0002_liveview'`)
    .first<{ id: string }>();
  if (applied) return;

  for (const statement of statements(extraSql)) {
    try {
      await db.prepare(statement).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column/i.test(message)) throw error;
    }
  }
  await db
    .prepare(`INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0002_liveview', ?)`)
    .bind(new Date().toISOString())
    .run();
}
