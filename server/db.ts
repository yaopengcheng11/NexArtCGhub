import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

// Use a data folder to persist DB file
const dbPath = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dbPath)) {
  fs.mkdirSync(dbPath, { recursive: true });
}

export async function initDb() {
  const db = await open({
    filename: path.join(dbPath, 'database.sqlite'),
    driver: sqlite3.Database
  });

  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    );

    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      category TEXT,
      tags TEXT,
      imageUrl TEXT,
      fileUrl TEXT,
      downloadCount INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default admin (if not exists)
  // username: admin, password: adminpassword (you should change this!)
  const adminExists = await db.get('SELECT * FROM users WHERE username = ?', ['admin']);
  if (!adminExists) {
    const hash = await bcrypt.hash('admin123', 10);
    await db.run('INSERT INTO users (username, password) VALUES (?, ?)', ['admin', hash]);
  }

  // Seed some initial data for visual testing if DB is empty
  const resourceCount = await db.get('SELECT COUNT(*) as count FROM resources');
  if (resourceCount.count === 0) {
    const seeds = [
      {
        title: 'Houdini Procedural City Generator',
        description: 'A powerful Node setup for creating procedural cities instantly. Completely parameterized and ready for Redshift rendering.',
        category: 'Houdini',
        tags: '["procedural", "city", "hda", "generator"]',
        imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop',
        fileUrl: '#'
      },
      {
        title: 'UE5 Realistic Environment Pack',
        description: 'A collection of 50+ nanite-enabled realistic foliage and rock photogrammetry assets for Unreal Engine 5.',
        category: 'UE',
        tags: '["nanite", "environment", "photogrammetry"]',
        imageUrl: 'https://images.unsplash.com/photo-1542831371-29b0f74f9713?q=80&w=2700&auto=format&fit=crop',
        fileUrl: '#'
      },
      {
        title: 'Blender Hard Surface Addon',
        description: 'An ultimate workflow enhancer for hard surface modeling in Blender 4.0+. Cut, bevel, and detail with a single click.',
        category: 'Blender',
        tags: '["addon", "hard-surface", "modeling"]',
        imageUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2000&auto=format&fit=crop',
        fileUrl: '#'
      }
    ];

    const stmt = await db.prepare('INSERT INTO resources (title, description, category, tags, imageUrl, fileUrl) VALUES (?, ?, ?, ?, ?, ?)');
    for (const seed of seeds) {
      await stmt.run(seed.title, seed.description, seed.category, seed.tags, seed.imageUrl, seed.fileUrl);
    }
    await stmt.finalize();
  }

  return db;
}
