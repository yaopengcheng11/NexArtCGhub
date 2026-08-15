import express from 'express';
import { createServer as createViteServer } from 'vite';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { initDb } from './server/db.js';
import path from 'path';

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_super_secret_cg_hub';

async function startServer() {
  const app = express();
  
  app.use(express.json());
  app.use(cookieParser());

  const db = await initDb();

  // --- API Routes ---

  // Auth Middleware
  const requireAdmin = (req: any, res: any, next: any) => {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (e) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  // Auth endpoints
  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
      const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1d' });
      res.cookie('admin_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
      res.json({ message: 'Logged in' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.json({ message: 'Logged out' });
  });

  app.get('/api/auth/me', requireAdmin, (req: any, res: any) => {
    res.json({ user: req.user });
  });

  // Resources CRUD endpoints
  // List all (public)
  app.get('/api/resources', async (req, res) => {
    const { category, search } = req.query;
    let query = 'SELECT * FROM resources WHERE 1=1';
    const params: any[] = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    if (search) {
      query += ' AND (title LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' ORDER BY createdAt DESC';

    try {
      const resources = await db.all(query, params);
      res.json(resources);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single (public)
  app.get('/api/resources/:id', async (req, res) => {
    try {
      const resource = await db.get('SELECT * FROM resources WHERE id = ?', [req.params.id]);
      if (!resource) return res.status(404).json({ error: 'Not found' });
      res.json(resource);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Increment download (public)
  app.post('/api/resources/:id/download', async (req, res) => {
    try {
      await db.run('UPDATE resources SET downloadCount = downloadCount + 1 WHERE id = ?', [req.params.id]);
      res.json({ message: 'Incremented' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create (admin)
  app.post('/api/resources', requireAdmin, async (req: any, res: any) => {
    const { title, description, category, tags, imageUrl, fileUrl } = req.body;
    try {
      const result = await db.run(
        'INSERT INTO resources (title, description, category, tags, imageUrl, fileUrl) VALUES (?, ?, ?, ?, ?, ?)',
        [title, description, category, tags, imageUrl, fileUrl]
      );
      res.status(201).json({ id: result.lastID });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update (admin)
  app.put('/api/resources/:id', requireAdmin, async (req: any, res: any) => {
    const { title, description, category, tags, imageUrl, fileUrl } = req.body;
    try {
      await db.run(
        'UPDATE resources SET title = ?, description = ?, category = ?, tags = ?, imageUrl = ?, fileUrl = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
        [title, description, category, tags, imageUrl, fileUrl, req.params.id]
      );
      res.json({ message: 'Updated' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete (admin)
  app.delete('/api/resources/:id', requireAdmin, async (req: any, res: any) => {
    try {
      await db.run('DELETE FROM resources WHERE id = ?', [req.params.id]);
      res.json({ message: 'Deleted' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production serving
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
