import { createClient, Client, ResultSet, InValue } from '@libsql/client';
import path from 'path';
import fs from 'fs';

let client: Client;

export function getDatabase(): Client {
  if (!client) throw new Error('Database not initialized');
  return client;
}

// Helper: run a single query and return all rows as plain objects
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = any[];

export async function dbAll<T = Record<string, unknown>>(
  sql: string,
  args: Args = []
): Promise<T[]> {
  const result = await client.execute({ sql, args });
  return result.rows as unknown as T[];
}

export async function dbGet<T = Record<string, unknown>>(
  sql: string,
  args: Args = []
): Promise<T | undefined> {
  const result = await client.execute({ sql, args });
  return result.rows[0] as unknown as T | undefined;
}

export async function dbRun(
  sql: string,
  args: Args = []
): Promise<{ lastInsertRowid: number; changes: number }> {
  const result = await client.execute({ sql, args });
  return {
    lastInsertRowid: Number(result.lastInsertRowid ?? 0),
    changes: result.rowsAffected,
  };
}

export async function dbBatch(
  stmts: { sql: string; args?: Args }[]
): Promise<ResultSet[]> {
  return client.batch(
    stmts.map((s) => ({ sql: s.sql, args: s.args })),
    'write'
  );
}

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT,
  avatar TEXT,
  free_music_count INTEGER DEFAULT 3,
  role TEXT DEFAULT 'user',
  banned_until DATETIME,
  country_code TEXT,
  bio TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  language TEXT DEFAULT 'cmn',
  country_code TEXT,
  like_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS music (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  file_path TEXT,
  duration INTEGER,
  style TEXT,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  user_id INTEGER,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_hidden INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (story_id) REFERENCES stories(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS burned_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL UNIQUE,
  burned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan_type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'CNY',
  status TEXT DEFAULT 'pending',
  total_cents INTEGER,
  payment_provider TEXT,
  payment_id TEXT,
  coupon_code TEXT,
  metadata TEXT,
  updated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS music_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  story_id INTEGER NOT NULL,
  music_id INTEGER NOT NULL,
  used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (story_id) REFERENCES stories(id),
  FOREIGN KEY (music_id) REFERENCES music(id)
);

CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  music_limit INTEGER,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  product_id INTEGER NOT NULL,
  starts_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  music_remaining INTEGER,
  status TEXT DEFAULT 'active',
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  discount_percent INTEGER,
  discount_cents INTEGER,
  valid_from DATETIME,
  valid_until DATETIME,
  max_uses INTEGER,
  used_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id INTEGER NOT NULL,
  followed_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (follower_id) REFERENCES users(id),
  FOREIGN KEY (followed_id) REFERENCES users(id),
  UNIQUE(follower_id, followed_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  actor_id INTEGER,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_user_id) REFERENCES users(id),
  FOREIGN KEY (to_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS blocked_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (blocker_id) REFERENCES users(id),
  FOREIGN KEY (blocked_id) REFERENCES users(id),
  UNIQUE(blocker_id, blocked_id)
);
`;

async function addColumnIfMissing(table: string, column: string, def: string): Promise<void> {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  } catch (err: any) {
    // Only ignore "duplicate column" errors — anything else is a real problem
    if (err?.message?.includes('duplicate column')) return;
    throw err;
  }
}

export async function initDatabase(): Promise<void> {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl && tursoToken) {
    // Production: Turso cloud SQLite
    client = createClient({ url: tursoUrl, authToken: tursoToken });
    console.log('[DB] Connected to Turso cloud database');
  } else {
    // Development: local SQLite file
    const dbPath = process.env.DB_PATH || './data/app.db';
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    client = createClient({ url: `file:${path.resolve(dbPath)}` });
    console.log('[DB] Using local SQLite file:', dbPath);
  }

  // Create tables — split on semicolons to execute one at a time (libsql requirement)
  const statements = CREATE_TABLES
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sql of statements) {
    await client.execute(sql);
  }

  // Migrations for existing databases
  await addColumnIfMissing('users', 'role', "TEXT DEFAULT 'user'");
  await addColumnIfMissing('users', 'banned_until', 'DATETIME');
  await addColumnIfMissing('users', 'country_code', 'TEXT');
  await addColumnIfMissing('users', 'bio', 'TEXT');
  await addColumnIfMissing('stories', 'language', "TEXT DEFAULT 'cmn'");
  await addColumnIfMissing('stories', 'country_code', 'TEXT');
  await addColumnIfMissing('stories', 'like_count', 'INTEGER DEFAULT 0');
  await addColumnIfMissing('comments', 'like_count', 'INTEGER DEFAULT 0');
  await addColumnIfMissing('comments', 'user_id', 'INTEGER');
  await addColumnIfMissing('comments', 'is_hidden', 'INTEGER DEFAULT 0');
  await addColumnIfMissing('orders', 'total_cents', 'INTEGER');
  await addColumnIfMissing('orders', 'payment_provider', 'TEXT');
  await addColumnIfMissing('orders', 'payment_id', 'TEXT');
  await addColumnIfMissing('orders', 'metadata', 'TEXT');
  await addColumnIfMissing('orders', 'updated_at', 'DATETIME');
  await addColumnIfMissing('orders', 'coupon_code', 'TEXT');
  await addColumnIfMissing('stories', 'tags', 'TEXT');
  await addColumnIfMissing('stories', 'tone', 'TEXT');
  await addColumnIfMissing('music', 'music_type', "TEXT DEFAULT 'instrumental'");
  await addColumnIfMissing('music', 'generation_params', 'TEXT');
  await addColumnIfMissing('stories', 'cover_image', 'TEXT');
  await addColumnIfMissing('stories', 'cover_prompt', 'TEXT');

  // Seed default products if none exist
  const productCountResult = await client.execute('SELECT COUNT(*) as count FROM products');
  const productCount = Number((productCountResult.rows[0] as any).count);
  if (productCount === 0) {
    await client.batch([
      { sql: "INSERT INTO products (name, type, price_cents, music_limit, description) VALUES ('按次付费', 'per_use', 100, 1, '1次音乐生成')" },
      { sql: "INSERT INTO products (name, type, price_cents, music_limit, description) VALUES ('月度会员', 'monthly', 3000, 60, '30天内60次音乐生成')" },
      { sql: "INSERT INTO products (name, type, price_cents, music_limit, description) VALUES ('年度会员', 'yearly', 28800, NULL, '365天内无限次音乐生成')" },
    ], 'write');
  }

  await client.execute('PRAGMA foreign_keys = ON;');
  console.log('[DB] Database initialized');
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    client.close();
  }
}
