import schemaSql from '../migrations/0001_init.sql';
import extraSql from '../migrations/0002_liveview.sql';
import goliveSql from '../migrations/0003_golive.sql';
import overlaySql from '../migrations/0004_overlays.sql';
import glanceSql from '../migrations/0005_glance.sql';
import lightsSql from '../migrations/0006_glance_lights.sql';
import locationSql from '../migrations/0007_glance_location.sql';
import layoutSql from '../migrations/0008_glance_layout.sql';
import googleSql from '../migrations/0009_glance_google.sql';
import { GLANCE_INITIAL_PASSWORD_HASH } from './glance/defaults';

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

  await applyMigration(db, '0002_liveview', extraSql);
  await applyMigration(db, '0003_golive', goliveSql);
  await applyMigration(db, '0004_overlays', overlaySql);
  await applyMigration(db, '0005_glance', glanceSql);
  await applyMigration(db, '0006_glance_lights', lightsSql);
  await applyMigration(db, '0007_glance_location', locationSql);
  await applyMigration(db, '0008_glance_layout', layoutSql);
  await applyMigration(db, '0009_glance_google', googleSql);
  await db
    .prepare(
      `INSERT OR IGNORE INTO glance_settings (id, password_hash, updated_at) VALUES ('default', ?, ?)`
    )
    .bind(GLANCE_INITIAL_PASSWORD_HASH, new Date().toISOString())
    .run();
}

async function applyMigration(db: D1Database, id: string, sql: string) {
  const applied = await db
    .prepare(`SELECT id FROM schema_migrations WHERE id = ?`)
    .bind(id)
    .first<{ id: string }>();
  if (applied) return;

  for (const statement of statements(sql)) {
    try {
      await db.prepare(statement).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column|already exists/i.test(message)) throw error;
    }
  }
  await db
    .prepare(`INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)`)
    .bind(id, new Date().toISOString())
    .run();
}
