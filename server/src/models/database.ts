import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database;

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function initDatabase(): void {
  const dbPath = process.env.DB_PATH || './data/app.db';
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
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
      target_type TEXT NOT NULL CHECK(target_type IN ('story', 'comment')),
      target_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('per_use', 'monthly', 'yearly')),
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
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'expired', 'cancelled')),
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
  `);

  // Seed default products
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
  if (productCount.count === 0) {
    db.prepare(`
      INSERT INTO products (name, type, price_cents, music_limit, description) VALUES
        ('按次付费', 'per_use', 100, 1, '1次音乐生成'),
        ('月度会员', 'monthly', 3000, 60, '30天内60次音乐生成'),
        ('年度会员', 'yearly', 28800, NULL, '365天内无限次音乐生成')
    `).run();
  }

  // Migrate columns for existing databases
  const addColumnIfMissing = (table: string, column: string, def: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`); } catch { /* exists */ }
  };
  addColumnIfMissing('users', 'role', "TEXT DEFAULT 'user'");
  addColumnIfMissing('users', 'banned_until', 'DATETIME');
  addColumnIfMissing('users', 'country_code', 'TEXT');
  addColumnIfMissing('users', 'bio', 'TEXT');
  addColumnIfMissing('stories', 'language', "TEXT DEFAULT 'cmn'");
  addColumnIfMissing('stories', 'country_code', 'TEXT');
  addColumnIfMissing('stories', 'like_count', 'INTEGER DEFAULT 0');
  addColumnIfMissing('comments', 'like_count', 'INTEGER DEFAULT 0');
  addColumnIfMissing('comments', 'user_id', 'INTEGER');
  addColumnIfMissing('orders', 'total_cents', 'INTEGER');
  addColumnIfMissing('orders', 'payment_provider', 'TEXT');
  addColumnIfMissing('orders', 'payment_id', 'TEXT');
  addColumnIfMissing('orders', 'metadata', 'TEXT');
  addColumnIfMissing('orders', 'updated_at', 'DATETIME');
  addColumnIfMissing('orders', 'coupon_code', 'TEXT');

  console.log('Database initialized');
}

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}