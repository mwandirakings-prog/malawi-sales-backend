const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'sabias-secret-key-2026';

const USERS = [
  {
    id: 1,
    name: 'Kings Mwandira',
    email: 'admin@sabias.com',
    password: 'Admin@2026',
    role: 'admin',
    region: 'all'
  },
  {
    id: 2,
    name: 'Tadala Banda',
    email: 'tadala@sabias.com',
    password: 'Sales@2026',
    role: 'salesperson',
    region: 'Lilongwe'
  },
  {
    id: 3,
    name: 'Kondwani Phiri',
    email: 'kondwani@sabias.com',
    password: 'Sales@2026',
    role: 'salesperson',
    region: 'Blantyre'
  },
  {
    id: 4,
    name: 'Grace Mkandawire',
    email: 'grace@sabias.com',
    password: 'Sales@2026',
    role: 'salesperson',
    region: 'Mzuzu'
  },
  {
    id: 5,
    name: 'Board Viewer',
    email: 'viewer@sabias.com',
    password: 'View@2026',
    role: 'viewer',
    region: 'all'
  },
];

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = USERS.find(u => u.email === email && u.password === password);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  }
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, region: user.region },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({
    success: true,
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, region: user.region }
  });
});

router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ success: false });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ success: true, user: decoded });
  } catch {
    res.status(401).json({ success: false });
  }
});

module.exports = router;