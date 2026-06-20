const https = require('https');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const pool = require('./db');
const { protect, adminOnly, noViewer } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://sabiasanalytics.com',
    'https://www.sabiasanalytics.com',
    'https://info.sabiasanalytics.com',
    'https://api.sabiasanalytics.com',
    'https://sabiasanalytics.netlify.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'sabias-secret-key-2026';

// ── RATE LIMITING ─────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this device. Please try again in 15 minutes.'
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts from this device. Please try again in 15 minutes.'
  }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many registration attempts. Please try again in 1 hour.'
  }
});

app.use('/api/', generalLimiter);

// ── ROOT ──────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    message: 'SABIAS Multi-Company API is running!',
    version: '2.0.0',
    currency: 'MWK'
  });
});

// ── EMAIL HELPER ──────────────────────────────────────────
const sendEmail = async (to, subject, html) => {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      from: 'SABIAS <noreply@sabiasanalytics.com>',
      to: [to],
      subject,
      html,
    });
    const options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer re_3rnFvwpk_5mFTNHqCRKjexghimbN1REfb',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
};

// ── STOCK NOTIFICATION HELPER ─────────────────────────────
const notifyAdminStockAlert = async (item, salesperson, sale_date, company_id) => {
  try {
    const adminResult = await pool.query(
      `SELECT u.email, u.name, c.name as company_name
       FROM users u
       JOIN companies c ON c.id = u.company_id
       WHERE u.company_id = $1 AND u.role = 'admin'
       LIMIT 1`,
      [company_id]
    );
    if (adminResult.rows.length === 0) return;
    const admin = adminResult.rows[0];
    const newStock = parseInt(item.quantity_in_stock);
    const reorderLevel = parseInt(item.reorder_level);

    if (newStock === 0) {
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF8F0;padding:32px;border-radius:12px;">
          <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;text-align:center;margin-bottom:24px;">
            <div style="color:#FFB800;font-size:28px;font-weight:bold;letter-spacing:4px;">SABIAS</div>
            <div style="color:#FF6B35;font-size:11px;margin-top:4px;">Stock Alert System</div>
          </div>
          <div style="background:#FFEBEE;border-left:4px solid #E53935;border-radius:10px;padding:20px;margin-bottom:20px;">
            <div style="color:#C62828;font-size:20px;font-weight:bold;margin-bottom:8px;">OUT OF STOCK ALERT</div>
            <div style="color:#333;font-size:14px;line-height:1.6;">
              <strong>${item.product}</strong> is now completely out of stock at <strong>${admin.company_name}</strong>. Immediate action required!
            </div>
          </div>
          <div style="background:white;border-radius:10px;padding:20px;border-left:4px solid #E53935;margin-bottom:16px;">
            <div style="color:#888;font-size:12px;font-weight:bold;margin-bottom:12px;">PRODUCT DETAILS</div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Product: <strong>${item.product}</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Category: <strong>${item.category}</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Current Stock: <strong style="color:#C62828;">0 units</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Reorder Level: <strong>${reorderLevel} units</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Supplier: <strong>${item.supplier || 'N/A'}</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Last Sale by: <strong>${salesperson}</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Date: <strong>${sale_date}</strong></div>
          </div>
          <div style="background:#3E1F00;border-radius:10px;padding:16px;text-align:center;margin-bottom:16px;">
            <div style="color:#FFB800;font-weight:bold;font-size:14px;">Please reorder from ${item.supplier || 'your supplier'} immediately to avoid losing sales!</div>
          </div>
          <div style="text-align:center;color:#888;font-size:11px;">SABIAS Auto Stock Alert · ${admin.company_name}</div>
        </div>`;
      sendEmail(admin.email, `OUT OF STOCK: ${item.product} — ${admin.company_name}`, html)
        .catch(err => console.error('Out of stock email error:', err));

    } else if (newStock <= reorderLevel) {
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF8F0;padding:32px;border-radius:12px;">
          <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;text-align:center;margin-bottom:24px;">
            <div style="color:#FFB800;font-size:28px;font-weight:bold;letter-spacing:4px;">SABIAS</div>
            <div style="color:#FF6B35;font-size:11px;margin-top:4px;">Stock Alert System</div>
          </div>
          <div style="background:#FFF8E1;border-left:4px solid #FF8F00;border-radius:10px;padding:20px;margin-bottom:20px;">
            <div style="color:#E65100;font-size:20px;font-weight:bold;margin-bottom:8px;">LOW STOCK ALERT</div>
            <div style="color:#333;font-size:14px;line-height:1.6;">
              <strong>${item.product}</strong> is running low at <strong>${admin.company_name}</strong>. Please reorder soon.
            </div>
          </div>
          <div style="background:white;border-radius:10px;padding:20px;border-left:4px solid #FF8F00;margin-bottom:16px;">
            <div style="color:#888;font-size:12px;font-weight:bold;margin-bottom:12px;">PRODUCT DETAILS</div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Product: <strong>${item.product}</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Category: <strong>${item.category}</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Current Stock: <strong style="color:#E65100;">${newStock} units</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Reorder Level: <strong>${reorderLevel} units</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Suggested Order: <strong>${reorderLevel * 2} units</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Supplier: <strong>${item.supplier || 'N/A'}</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Last Sale by: <strong>${salesperson}</strong></div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Date: <strong>${sale_date}</strong></div>
          </div>
          <div style="background:#3E1F00;border-radius:10px;padding:16px;text-align:center;margin-bottom:16px;">
            <div style="color:#FFB800;font-weight:bold;font-size:14px;">Consider ordering at least ${reorderLevel * 2} units from ${item.supplier || 'your supplier'} soon.</div>
          </div>
          <div style="text-align:center;color:#888;font-size:11px;">SABIAS Auto Stock Alert · ${admin.company_name}</div>
        </div>`;
      sendEmail(admin.email, `LOW STOCK: ${item.product} — ${admin.company_name}`, html)
        .catch(err => console.error('Low stock email error:', err));
    }
  } catch (err) {
    console.error('Stock notification error:', err.message);
  }
};

// ── ONEKHUSA CONFIG ───────────────────────────────────────
const ONEKHUSA_API_KEY = 'live_fvhsx7QpZn9nhSN5kowW-BkY5shlqJUj7g';
const ONEKHUSA_API_SECRET = 'D-AGtrOiPtGOV_rib35EFKbh_flXmLSGlWbx_64eIpzLP7TJID56b3mBBBMC';
const ONEKHUSA_ORG_ID = 'LFT0XD8WJIQK';
const ONEKHUSA_MERCHANT = 87949766;

const PLAN_PRICES = {
  starter:      { monthly: 5000,  name: 'Starter' },
  professional: { monthly: 10000, name: 'Professional' },
  enterprise:   { monthly: 50000, name: 'Enterprise' }
};

const generateReference = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let ref = 'SAB';
  for (let i = 0; i < 9; i++) {
    ref += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ref;
};

// ── ONEKHUSA GET ACCESS TOKEN ─────────────────────────────
const getOneKhusaToken = async () => {
  const data = JSON.stringify({
    apiKey: ONEKHUSA_API_KEY,
    apiSecret: ONEKHUSA_API_SECRET,
    organisationId: ONEKHUSA_ORG_ID,
    merchantAccountNumber: ONEKHUSA_MERCHANT
  });
  const response = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.onekhusa.com',
      port: 443,
      path: '/live/v1/account/getAccessToken',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'en',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
  return response.accessToken;
};

// ── TRANSACTION LIMIT MIDDLEWARE ──────────────────────────
const checkTransactionLimit = async (req, res, next) => {
  try {
    const company_id = req.user ? req.user.company_id : req.company_id;
    const result = await pool.query(
      `SELECT subscription_status, subscription_expires_at,
              trial_ends_at, daily_sales_count, daily_sales_date
       FROM companies WHERE id = $1`,
      [company_id]
    );
    if (result.rows.length === 0) return next();
    const company = result.rows[0];
    const now = new Date();
    const trialEnd = new Date(company.trial_ends_at);
    const subEnd = company.subscription_expires_at ? new Date(company.subscription_expires_at) : null;
    const trialActive = company.subscription_status === 'trial' && trialEnd > now;
    const subActive = company.subscription_status === 'active' && subEnd && subEnd > now;
    if (trialActive || subActive) return next();
    const today = new Date().toISOString().split('T')[0];
    const lastDate = company.daily_sales_date
      ? new Date(company.daily_sales_date).toISOString().split('T')[0] : null;
    if (lastDate !== today) {
      await pool.query(
        `UPDATE companies SET daily_sales_count = 0, daily_sales_date = CURRENT_DATE WHERE id = $1`,
        [company_id]
      );
      company.daily_sales_count = 0;
    }
    if (company.daily_sales_count >= 10) {
      return res.status(429).json({
        success: false, limited: true,
        message: 'Daily limit of 10 transactions reached. Subscribe to SABIAS for unlimited transactions.',
        daily_count: company.daily_sales_count, daily_limit: 10
      });
    }
    await pool.query(
      `UPDATE companies SET daily_sales_count = daily_sales_count + 1, daily_sales_date = CURRENT_DATE WHERE id = $1`,
      [company_id]
    );
    next();
  } catch (err) {
    console.error('Transaction limit error:', err.message);
    next();
  }
};

// ── LOGIN ─────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT u.*, c.name as company_name FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE LOWER(u.email) = LOWER($1) AND u.active = true`,
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    const user = result.rows[0];
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Account locked due to too many failed attempts. Try again in ${minutesLeft} minute(s) or reset your password.`
      });
    }
    let passwordMatch = false;
    if (user.password && user.password.startsWith('$2')) {
      passwordMatch = await bcrypt.compare(password, user.password);
    } else {
      passwordMatch = (password === user.password);
      if (passwordMatch) {
        const hashed = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, user.id]);
      }
    }
    if (!passwordMatch) {
      const attempts = (user.login_attempts || 0) + 1;
      if (attempts >= 5) {
        const lockUntil = new Date(Date.now() + 30 * 60 * 1000);
        await pool.query(
          `UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3`,
          [attempts, lockUntil, user.id]
        );
        return res.status(423).json({
          success: false,
          message: 'Account locked for 30 minutes due to 5 failed login attempts. Please reset your password or try again later.'
        });
      } else {
        await pool.query('UPDATE users SET login_attempts = $1 WHERE id = $2', [attempts, user.id]);
        return res.status(401).json({
          success: false,
          message: `Invalid email or password. ${5 - attempts} attempt(s) remaining before account is locked.`
        });
      }
    }
    await pool.query(`UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1`, [user.id]);
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, company_id: user.company_id, region: user.region },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      success: true, token,
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role, region: user.region,
        company_id: user.company_id, company: user.company_name || 'SABIAS',
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── FORGOT PASSWORD ───────────────────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND active = true`, [email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No account found with this email address.' });
    }
    const user = result.rows[0];
    if (user.role !== 'admin') {
      return res.status(403).json({ success: false, role: user.role, error: 'Contact your admin to reset your password.' });
    }
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      `UPDATE users SET reset_token = $1, reset_token_expiry = $2, login_attempts = 0, locked_until = NULL WHERE LOWER(email) = LOWER($3)`,
      [token, expiry, email]
    );
    const resetLink = `https://www.sabiasanalytics.com?reset=${token}`;
    const resetHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF8F0;padding:32px;border-radius:12px;">
        <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;text-align:center;margin-bottom:24px;">
          <div style="color:#FFB800;font-size:28px;font-weight:bold;letter-spacing:4px;">SABIAS</div>
          <div style="color:#FF6B35;font-size:11px;margin-top:4px;">Sales & Business Intelligence Analytics System</div>
        </div>
        <h2 style="color:#3E1F00;margin:0 0 8px;">Password Reset Request</h2>
        <p style="color:#555;font-size:14px;line-height:1.6;">Hi ${user.name}, click below to reset your SABIAS password. This link expires in 1 hour.</p>
        <div style="background:#3E1F00;border-radius:10px;padding:16px;text-align:center;margin:24px 0;">
          <a href="${resetLink}" style="color:#FFB800;font-weight:bold;font-size:15px;text-decoration:none;">Reset My Password</a>
        </div>
        <div style="background:white;border-radius:10px;padding:16px;border-left:4px solid #FF6B35;margin-bottom:20px;">
          <div style="color:#888;font-size:12px;margin-bottom:4px;font-weight:bold;">SECURITY NOTICE</div>
          <div style="color:#555;font-size:13px;">If you did not request this, please ignore this email. Your password will not change.</div>
        </div>
        <p style="color:#888;font-size:12px;">Or copy this link:<br/><a href="${resetLink}" style="color:#FF6B35;">${resetLink}</a></p>
        <div style="text-align:center;color:#888;font-size:12px;margin-top:20px;">
          <strong style="color:#3E1F00;">Kings Mwandira</strong><br/>CEO, SABIAS
        </div>
      </div>`;
    sendEmail(email, 'SABIAS Password Reset Request', resetHtml)
      .catch(err => console.error('Reset email error:', err));
    res.json({ success: true, message: 'Password reset link sent to your email address.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── RESET PASSWORD ────────────────────────────────────────
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE reset_token = $1 AND reset_token_expiry > NOW() AND active = true`, [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Reset link is invalid or expired. Please request a new one.' });
    }
    const user = result.rows[0];
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL, login_attempts = 0, locked_until = NULL WHERE id = $2`,
      [hashedPassword, user.id]
    );
    res.json({ success: true, message: 'Password reset successfully! You can now login.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SEND OTP ──────────────────────────────────────────────
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email, company_name } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email address format.' });
    }
    const existing = await pool.query(
      'SELECT id FROM companies WHERE LOWER(email) = LOWER($1)', [email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'This email address is already registered.' });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      `INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET code = $2, expires_at = $3, created_at = NOW()`,
      [email.toLowerCase(), otp, expiry]
    );
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF8F0;padding:32px;border-radius:12px;">
        <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;text-align:center;margin-bottom:24px;">
          <div style="color:#FFB800;font-size:28px;font-weight:bold;letter-spacing:4px;">SABIAS</div>
          <div style="color:#FF6B35;font-size:11px;margin-top:4px;">Email Verification</div>
        </div>
        <h2 style="color:#3E1F00;margin:0 0 8px;">Verify Your Email Address</h2>
        <p style="color:#555;font-size:14px;line-height:1.7;">Hi! You are registering <strong>${company_name}</strong> on SABIAS. Enter this code to complete your registration:</p>
        <div style="background:#3E1F00;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
          <div style="color:#FFB800;font-size:42px;font-weight:bold;letter-spacing:12px;">${otp}</div>
          <div style="color:#FF6B35;font-size:12px;margin-top:8px;">This code expires in 10 minutes</div>
        </div>
        <div style="background:white;border-radius:10px;padding:16px;border-left:4px solid #FF6B35;margin-bottom:20px;">
          <div style="color:#888;font-size:12px;font-weight:bold;margin-bottom:4px;">SECURITY NOTICE</div>
          <div style="color:#555;font-size:13px;">If you did not request this, please ignore this email. Do not share this code with anyone.</div>
        </div>
        <div style="text-align:center;color:#888;font-size:12px;">
          <strong style="color:#3E1F00;">Kings Mwandira</strong><br/>CEO, SABIAS · 0996 175 162
        </div>
      </div>`;
    console.log('Sending OTP to:', email, 'OTP:', otp);
    await sendEmail(email, 'SABIAS — Your Verification Code', html);
    res.json({ success: true, message: 'Verification code sent to your email address.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── COMPANY REGISTRATION ──────────────────────────────────
app.post('/api/companies/register', registerLimiter, async (req, res) => {
  const { company_name, email, phone, city, address, admin_name, password, otp } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const otpResult = await client.query(
      `SELECT * FROM otp_codes WHERE LOWER(email) = LOWER($1) AND code = $2 AND expires_at > NOW()`,
      [email, otp]
    );
    if (otpResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP code. Please request a new code.' });
    }
    await client.query('DELETE FROM otp_codes WHERE LOWER(email) = LOWER($1)', [email]);
    const existing = await client.query('SELECT id FROM companies WHERE LOWER(email) = LOWER($1)', [email]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'A company with this email already exists!' });
    }
    const compResult = await client.query(
      `INSERT INTO companies (name, email, phone, city, address) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [company_name, email, phone, city, address]
    );
    const company = compResult.rows[0];
    const hashedPassword = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO users (name, email, password, role, region, company_id, active) VALUES ($1,$2,$3,'admin','all',$4, true)`,
      [admin_name, email, hashedPassword, company.id]
    );
    await client.query('COMMIT');

    const welcomeHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF8F0;padding:32px;border-radius:12px;">
        <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;text-align:center;margin-bottom:24px;">
          <div style="color:#FFB800;font-size:28px;font-weight:bold;letter-spacing:4px;">SABIAS</div>
          <div style="color:#FF6B35;font-size:11px;margin-top:4px;">Sales & Business Intelligence Analytics System</div>
        </div>
        <h2 style="color:#3E1F00;margin:0 0 8px;">Hi ${admin_name},</h2>
        <p style="color:#555;font-size:15px;line-height:1.6;">Welcome to <strong>SABIAS</strong>! Your company <strong style="color:#FF6B35;">${company_name}</strong> has been successfully registered.</p>
        <div style="background:white;border-radius:10px;padding:20px;margin:20px 0;border-left:4px solid #FF6B35;">
          <div style="color:#888;font-size:12px;margin-bottom:8px;font-weight:bold;">YOUR REGISTRATION DETAILS</div>
          <div style="color:#3E1F00;font-size:14px;margin:6px 0;">Email: <strong>${email}</strong></div>
          <div style="color:#3E1F00;font-size:14px;margin:6px 0;">Company: <strong>${company_name}</strong></div>
          <div style="color:#3E1F00;font-size:14px;margin:6px 0;">District: <strong>${city}</strong></div>
          <div style="color:#3E1F00;font-size:14px;margin:6px 0;">Admin: <strong>${admin_name}</strong></div>
        </div>
        <div style="background:#3E1F00;border-radius:10px;padding:16px;text-align:center;margin-top:24px;">
          <a href="https://www.sabiasanalytics.com" style="color:#FFB800;font-weight:bold;font-size:15px;text-decoration:none;">Login to SABIAS</a>
        </div>
        <div style="text-align:center;margin-top:24px;color:#888;font-size:12px;">
          <strong style="color:#3E1F00;">Kings Mwandira</strong><br/>CEO, SABIAS
        </div>
      </div>`;

    const notifyHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF8F0;padding:32px;border-radius:12px;">
        <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;text-align:center;margin-bottom:24px;">
          <div style="color:#FFB800;font-size:28px;font-weight:bold;letter-spacing:4px;">SABIAS</div>
          <div style="color:#FF6B35;font-size:11px;margin-top:4px;">New Company Registration Alert</div>
        </div>
        <h2 style="color:#3E1F00;">New Company Registered!</h2>
        <div style="background:white;border-radius:10px;padding:20px;margin:20px 0;border-left:4px solid #2D6A4F;">
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Company: <strong>${company_name}</strong></div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Admin: <strong>${admin_name}</strong></div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Email: <strong>${email}</strong></div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Phone: <strong>${phone}</strong></div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">District: <strong>${city}</strong></div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Registered: <strong>${new Date().toLocaleString()}</strong></div>
        </div>
        <p style="color:#555;font-size:13px;">Call <strong>${phone}</strong> to follow up.</p>
      </div>`;

    sendEmail(email, `Welcome to SABIAS, ${admin_name}!`, welcomeHtml)
      .catch(err => console.error('Welcome email error:', err));
    sendEmail('mwandirakings@gmail.com', `New SABIAS Registration: ${company_name}`, notifyHtml)
      .catch(err => console.error('Notify email error:', err));

    res.json({ success: true, message: 'Company registered successfully!', company_id: company.id, company_name: company.name });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ── GET COMPANIES ─────────────────────────────────────────
app.get('/api/companies', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT c.*, COUNT(u.id) as user_count FROM companies c
       LEFT JOIN users u ON u.company_id = c.id
       WHERE c.id = $1 GROUP BY c.id`,
      [company_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SALES — GET ───────────────────────────────────────────
app.get('/api/sales', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { include_deleted } = req.query;
    const result = await pool.query(
      `SELECT * FROM sales WHERE company_id = $1
       ${include_deleted === 'true' ? '' : 'AND deleted_at IS NULL'}
       ORDER BY sale_date DESC`,
      [company_id]
    );
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SALES — POST ──────────────────────────────────────────
app.post('/api/sales', protect, noViewer, checkTransactionLimit, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { sale_date, product, category, region, customer,
            quantity, unit_price, unit_cost, salesperson, payment } = req.body;
    const result = await pool.query(
      `INSERT INTO sales (sale_date, product, category, region, customer,
        quantity, unit_price, unit_cost, salesperson, payment, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [sale_date, product, category, region, customer,
       quantity, unit_price, unit_cost, salesperson, payment, company_id]
    );
    const invResult = await pool.query(
      `UPDATE inventory SET quantity_in_stock = GREATEST(quantity_in_stock - $1, 0), updated_at = NOW()
       WHERE LOWER(product) = LOWER($2) AND company_id = $3 RETURNING *`,
      [quantity, product, company_id]
    );
    if (invResult.rows.length > 0) {
      const item = invResult.rows[0];
      const newStock = parseInt(item.quantity_in_stock);
      const reorderLevel = parseInt(item.reorder_level);
      if (newStock === 0 || newStock <= reorderLevel) {
        notifyAdminStockAlert(item, salesperson, sale_date, company_id);
      }
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SALES — SOFT DELETE ───────────────────────────────────
app.delete('/api/sales/:id', protect, noViewer, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;
    await pool.query(`UPDATE sales SET deleted_at = NOW() WHERE id = $1 AND company_id = $2`, [id, company_id]);
    res.json({ success: true, message: 'Sale moved to trash.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SALES — RESTORE ───────────────────────────────────────
app.put('/api/sales/:id/restore', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;
    await pool.query(`UPDATE sales SET deleted_at = NULL WHERE id = $1 AND company_id = $2`, [id, company_id]);
    res.json({ success: true, message: 'Sale restored successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SALE APPROVAL — APPROVE ───────────────────────────────
app.put('/api/sales/:id/approve', protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;
    const result = await pool.query(
      `UPDATE sales SET approval_status = 'approved' WHERE id = $1 AND company_id = $2 RETURNING *`,
      [id, company_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SALE APPROVAL — REJECT ────────────────────────────────
app.put('/api/sales/:id/reject', protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;
    const saleResult = await pool.query(
      'SELECT * FROM sales WHERE id = $1 AND company_id = $2', [id, company_id]
    );
    if (saleResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Sale not found' });
    }
    const sale = saleResult.rows[0];
    await pool.query(
      `UPDATE inventory SET quantity_in_stock = quantity_in_stock + $1
       WHERE LOWER(product) = LOWER($2) AND company_id = $3`,
      [sale.quantity, sale.product, company_id]
    );
    await pool.query(
      `UPDATE sales SET approval_status = 'rejected' WHERE id = $1 AND company_id = $2`,
      [id, company_id]
    );
    res.json({ success: true, message: 'Sale rejected and stock restored.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── KPI SUMMARY ───────────────────────────────────────────
app.get('/api/kpis', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(`
      SELECT SUM(quantity * unit_price) AS total_revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS total_profit,
        COUNT(*) AS total_records, SUM(quantity) AS total_units,
        ROUND(AVG(unit_price),2) AS avg_unit_price
      FROM sales WHERE company_id = $1
    `, [company_id]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REVENUE BY REGION ─────────────────────────────────────
app.get('/api/regions', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(`
      SELECT region, SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit, COUNT(*) AS records
      FROM sales WHERE company_id = $1
      GROUP BY region ORDER BY revenue DESC
    `, [company_id]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REVENUE BY CATEGORY ───────────────────────────────────
app.get('/api/categories', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(`
      SELECT category, SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit, COUNT(*) AS records
      FROM sales WHERE company_id = $1 GROUP BY category ORDER BY revenue DESC
    `, [company_id]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── MONTHLY TREND ─────────────────────────────────────────
app.get('/api/monthly', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(`
      SELECT TO_CHAR(sale_date, 'YYYY-MM') AS month,
        SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit, COUNT(*) AS records
      FROM sales WHERE company_id = $1
      GROUP BY TO_CHAR(sale_date, 'YYYY-MM') ORDER BY month ASC
    `, [company_id]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── INVENTORY SUMMARY ─────────────────────────────────────
app.get('/api/inventory/summary', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(`
      SELECT COUNT(*) as total_products, SUM(quantity_in_stock) as total_units,
        SUM(quantity_in_stock * unit_cost) as total_cost_value,
        SUM(quantity_in_stock * unit_price) as total_retail_value,
        COUNT(CASE WHEN quantity_in_stock = 0 THEN 1 END) as out_of_stock,
        COUNT(CASE WHEN quantity_in_stock > 0 AND quantity_in_stock <= reorder_level THEN 1 END) as low_stock
      FROM inventory WHERE company_id = $1
    `, [company_id]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── INVENTORY — GET ───────────────────────────────────────
app.get('/api/inventory', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT * FROM inventory WHERE company_id = $1 ORDER BY product ASC`, [company_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── INVENTORY — POST ──────────────────────────────────────
app.post('/api/inventory', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { product, category, unit_price, unit_cost, quantity_in_stock, reorder_level, supplier } = req.body;
    const result = await pool.query(
      `INSERT INTO inventory (product, category, unit_price, unit_cost, quantity_in_stock, reorder_level, supplier, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [product, category, unit_price, unit_cost, quantity_in_stock, reorder_level, supplier, company_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── INVENTORY — PUT ───────────────────────────────────────
app.put('/api/inventory/:id', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;
    const { quantity_in_stock, unit_price, unit_cost, reorder_level, supplier } = req.body;
    const result = await pool.query(
      `UPDATE inventory SET quantity_in_stock=$1, unit_price=$2, unit_cost=$3,
       reorder_level=$4, supplier=$5, updated_at=NOW()
       WHERE id=$6 AND company_id=$7 RETURNING *`,
      [quantity_in_stock, unit_price, unit_cost, reorder_level, supplier, id, company_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── INVENTORY — DELETE ────────────────────────────────────
app.delete('/api/inventory/:id', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;
    await pool.query('DELETE FROM inventory WHERE id=$1 AND company_id=$2', [id, company_id]);
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── USERS — GET ───────────────────────────────────────────
app.get('/api/users', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT id, name, email, role, region, active, company_id, created_at
       FROM users WHERE company_id = $1 ORDER BY created_at DESC`,
      [company_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── USERS — POST ──────────────────────────────────────────
app.post('/api/users', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { name, email, password, role, region } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, region, company_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, role, region, active`,
      [name, email, hashedPassword, role, region, company_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── USERS — PUT ───────────────────────────────────────────
app.put('/api/users/:id', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;
    const { name, role, region, active } = req.body;
    const result = await pool.query(
      `UPDATE users SET name=$1, role=$2, region=$3, active=$4
       WHERE id=$5 AND company_id=$6 RETURNING id, name, email, role, region, active`,
      [name, role, region, active, id, company_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── USERS — RESET PASSWORD ────────────────────────────────
app.put('/api/users/:id/password', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;
    const { password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE users SET password=$1, login_attempts=0, locked_until=NULL WHERE id=$2 AND company_id=$3`,
      [hashedPassword, id, company_id]
    );
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── USERS — DELETE ────────────────────────────────────────
app.delete('/api/users/:id', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;
    await pool.query('DELETE FROM users WHERE id=$1 AND company_id=$2', [id, company_id]);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PROFILE — UPDATE ──────────────────────────────────────
app.put('/api/auth/profile', protect, async (req, res) => {
  try {
    const { name, email } = req.body;
    const user_id = req.user.id;
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Name must be at least 2 characters.' });
    }
    if (email) {
      const existing = await pool.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2`, [email, user_id]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'This email is already used by another account.' });
      }
    }
    const result = await pool.query(
      `UPDATE users SET name = $1, email = COALESCE($2, email) WHERE id = $3
       RETURNING id, name, email, role, region, company_id`,
      [name.trim(), email?.trim() || null, user_id]
    );
    res.json({ success: true, message: 'Profile updated successfully!', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PASSWORD — CHANGE ─────────────────────────────────────
app.put('/api/auth/change-password', protect, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const user_id = req.user.id;
    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, error: 'Current and new password are required.' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters.' });
    }
    const result = await pool.query('SELECT password FROM users WHERE id = $1', [user_id]);
    const user = result.rows[0];
    const match = await bcrypt.compare(current_password, user.password);
    if (!match) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect.' });
    }
    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query(
      `UPDATE users SET password = $1, login_attempts = 0, locked_until = NULL WHERE id = $2`,
      [hashed, user_id]
    );
    res.json({ success: true, message: 'Password changed successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN MIDDLEWARE ────────────────────────────────
const superAdminOnly = (req, res, next) => {
  if (req.user.email !== 'sabiascustomercare@gmail.com') {
    return res.status(403).json({ success: false, message: 'Super Admin access required.' });
  }
  next();
};

// ── SUPER ADMIN — GET ALL COMPANIES ──────────────────────
app.get('/api/superadmin/companies', protect, superAdminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.email, c.phone, c.city, c.country,
        c.active, c.plan, c.created_at, c.trial_ends_at,
        c.subscription_status, c.subscription_expires_at,
        COUNT(u.id) as user_count, NOW() as current_time
      FROM companies c LEFT JOIN users u ON u.company_id = c.id
      GROUP BY c.id ORDER BY c.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN — TOGGLE COMPANY ACTIVE ──────────────────
app.put('/api/superadmin/companies/:id/toggle', protect, superAdminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`UPDATE companies SET active = NOT active WHERE id = $1 RETURNING *`, [id]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN — EXTEND TRIAL ────────────────────────────
app.put('/api/superadmin/companies/:id/extend', protect, superAdminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { days } = req.body;
    const result = await pool.query(
      `UPDATE companies SET trial_ends_at = GREATEST(trial_ends_at, NOW()) + INTERVAL '1 day' * $1,
       subscription_status = 'trial', active = true WHERE id = $2 RETURNING *`,
      [days || 7, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN — ACTIVATE SUBSCRIPTION ──────────────────
app.put('/api/superadmin/companies/:id/activate', protect, superAdminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { months } = req.body;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + (months || 1));
    const result = await pool.query(
      `UPDATE companies SET subscription_status = 'active', subscription_expires_at = $1, active = true WHERE id = $2 RETURNING *`,
      [expiresAt, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN — REMOVE PAID PLAN ───────────────────────
app.put('/api/superadmin/companies/:id/remove-plan', protect, superAdminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE companies SET subscription_status = 'trial', subscription_expires_at = NULL WHERE id = $1 RETURNING *`, [id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN — DELETE COMPANY ──────────────────────────
app.delete('/api/superadmin/companies/:id', protect, superAdminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM users WHERE company_id = $1', [id]);
    await pool.query('DELETE FROM sales WHERE company_id = $1', [id]);
    await pool.query('DELETE FROM inventory WHERE company_id = $1', [id]);
    await pool.query('DELETE FROM companies WHERE id = $1', [id]);
    res.json({ success: true, message: 'Company deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN — GET API KEYS FOR COMPANY ────────────────
app.get('/api/superadmin/companies/:id/apikeys', protect, superAdminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, name, key_value, active, requests_today, requests_total, last_used_at, created_at
       FROM api_keys WHERE company_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── TRIAL STATUS ──────────────────────────────────────────
app.get('/api/trial/status', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT active, trial_ends_at, subscription_status, subscription_expires_at,
              daily_sales_count, daily_sales_date, NOW() as current_time
       FROM companies WHERE id = $1`,
      [company_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    const company = result.rows[0];
    const now = new Date();
    const trialEnd = new Date(company.trial_ends_at);
    const subEnd = company.subscription_expires_at ? new Date(company.subscription_expires_at) : null;
    const daysLeftTrial = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
    const daysLeftSub = subEnd ? Math.ceil((subEnd - now) / (1000 * 60 * 60 * 24)) : null;
    const today = new Date().toISOString().split('T')[0];
    const lastDate = company.daily_sales_date
      ? new Date(company.daily_sales_date).toISOString().split('T')[0] : null;
    const dailyCount = lastDate !== today ? 0 : (company.daily_sales_count || 0);
    let status = 'active', daysLeft = null, message = '', limited = false;
    if (company.subscription_status === 'trial') {
      if (daysLeftTrial <= 0) {
        status = 'limited'; limited = true;
        message = `Free trial ended. You have ${Math.max(0, 10 - dailyCount)} transactions left today. Subscribe for unlimited access.`;
      } else if (daysLeftTrial <= 3) {
        status = 'trial_warning'; daysLeft = daysLeftTrial;
        message = `Trial expires in ${daysLeftTrial} day(s)! Subscribe to keep unlimited access.`;
      } else {
        status = 'trial'; daysLeft = daysLeftTrial;
        message = `Free trial — ${daysLeftTrial} day(s) remaining.`;
      }
    } else if (company.subscription_status === 'active') {
      if (daysLeftSub !== null && daysLeftSub <= 0) {
        status = 'limited'; limited = true;
        message = `Subscription ended. You have ${Math.max(0, 10 - dailyCount)} transactions left today. Renew to restore unlimited access.`;
      } else if (daysLeftSub !== null && daysLeftSub <= 3) {
        status = 'sub_warning'; daysLeft = daysLeftSub;
        message = `Subscription expires in ${daysLeftSub} day(s)! Renew to avoid limits.`;
      } else {
        status = 'active'; daysLeft = daysLeftSub;
      }
    }
    res.json({
      success: true,
      data: {
        status, limited, daysLeft, message, dailyCount, dailyLimit: 10,
        remaining: limited ? Math.max(0, 10 - dailyCount) : 'unlimited',
        subscription_status: company.subscription_status,
        trial_ends_at: company.trial_ends_at,
        subscription_expires_at: company.subscription_expires_at,
        active: company.active,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── API KEY MIDDLEWARE ────────────────────────────────────
const apiKeyAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || (!authHeader.startsWith('Bearer sk_live_sabias_') && !authHeader.startsWith('Bearer sk_test_sabias_'))) {
      return res.status(401).json({
        success: false, error: 'Invalid or missing API key.',
        hint: 'Include your API key in the Authorization header: Bearer sk_live_sabias_xxxx'
      });
    }
    const keyValue = authHeader.replace('Bearer ', '').trim();
    const result = await pool.query(
      `SELECT ak.*, c.name as company_name, c.active as company_active
       FROM api_keys ak JOIN companies c ON c.id = ak.company_id
       WHERE ak.key_value = $1 AND ak.active = true`,
      [keyValue]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'API key not found or has been revoked.' });
    }
    const apiKey = result.rows[0];
    if (!apiKey.company_active) {
      return res.status(403).json({ success: false, error: 'Your company account is inactive. Contact SABIAS support.' });
    }
    if (apiKey.requests_today >= 1000) {
      return res.status(429).json({
        success: false, error: 'Daily request limit reached (1000/day). Limit resets at midnight.',
        requests_today: apiKey.requests_today, limit: 1000
      });
    }
    await pool.query(
      `UPDATE api_keys SET requests_today = requests_today + 1, requests_total = requests_total + 1, last_used_at = NOW() WHERE id = $1`,
      [apiKey.id]
    );
    req.apiKey = apiKey;
    req.company_id = apiKey.company_id;
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── GENERATE API KEY HELPER ───────────────────────────────
const generateApiKey = (type = 'live') => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const prefix = type === 'test' ? 'sk_test_sabias_' : 'sk_live_sabias_';
  let result = prefix;
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// ── API KEYS — GET ────────────────────────────────────────
app.get('/api/apikeys', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT id, name, key_value, active, requests_today, requests_total, last_used_at, created_at
       FROM api_keys WHERE company_id = $1 ORDER BY created_at DESC`,
      [company_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── API KEYS — CREATE ─────────────────────────────────────
app.post('/api/apikeys', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { name, key_type } = req.body;
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM api_keys WHERE company_id = $1 AND active = true', [company_id]
    );
    if (parseInt(countResult.rows[0].count) >= 3) {
      return res.status(400).json({ success: false, error: 'Maximum of 3 active API keys allowed per company.' });
    }
    const keyValue = generateApiKey(key_type || 'live');
    const result = await pool.query(
      `INSERT INTO api_keys (company_id, name, key_value) VALUES ($1, $2, $3) RETURNING *`,
      [company_id, name || 'My API Key', keyValue]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── API KEYS — REVOKE ─────────────────────────────────────
app.delete('/api/apikeys/:id', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;
    await pool.query(`UPDATE api_keys SET active = false WHERE id = $1 AND company_id = $2`, [id, company_id]);
    res.json({ success: true, message: 'API key revoked successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── API KEYS — RESET DAILY COUNTS ────────────────────────
app.post('/api/apikeys/reset-daily', async (req, res) => {
  try {
    await pool.query('UPDATE api_keys SET requests_today = 0');
    res.json({ success: true, message: 'Daily counts reset.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  PUBLIC API v1
// ══════════════════════════════════════════════════════════

app.get('/api/v1', apiKeyAuth, async (req, res) => {
  res.json({
    success: true, message: 'Welcome to SABIAS Public API v1',
    company: req.apiKey.company_name, api_key_name: req.apiKey.name,
    requests_today: req.apiKey.requests_today, requests_total: req.apiKey.requests_total,
    daily_limit: 1000,
    endpoints: {
      'GET /api/v1/sales': 'Get all sales', 'POST /api/v1/sales': 'Record a new sale',
      'GET /api/v1/inventory': 'Get all products', 'GET /api/v1/kpis': 'Get revenue and profit totals',
      'GET /api/v1/categories': 'Sales by category', 'GET /api/v1/regions': 'Sales by region',
      'GET /api/v1/monthly': 'Monthly revenue trend',
    },
    documentation: 'https://info.sabiasanalytics.com/api-docs.html',
    support: 'sabiascustomercare@gmail.com'
  });
});

app.get('/api/v1/sales', apiKeyAuth, async (req, res) => {
  try {
    const company_id = req.company_id;
    const { limit = 100, page = 1, from, to, product, region } = req.query;
    const offset = (page - 1) * limit;
    let query = `SELECT * FROM sales WHERE company_id = $1`;
    const params = [company_id];
    let p = 1;
    if (from) { p++; query += ` AND sale_date >= $${p}`; params.push(from); }
    if (to) { p++; query += ` AND sale_date <= $${p}`; params.push(to); }
    if (product) { p++; query += ` AND LOWER(product) LIKE LOWER($${p})`; params.push(`%${product}%`); }
    if (region) { p++; query += ` AND LOWER(region) = LOWER($${p})`; params.push(region); }
    p++; query += ` ORDER BY sale_date DESC LIMIT $${p}`; params.push(parseInt(limit));
    p++; query += ` OFFSET $${p}`; params.push(parseInt(offset));
    const result = await pool.query(query, params);
    res.json({ success: true, count: result.rows.length, page: parseInt(page), limit: parseInt(limit), data: result.rows, company: req.apiKey.company_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/sales', apiKeyAuth, checkTransactionLimit, async (req, res) => {
  try {
    const company_id = req.company_id;
    const { sale_date, product, category, region, customer, quantity, unit_price, unit_cost, salesperson, payment } = req.body;
    if (!product || !quantity || !unit_price) {
      return res.status(400).json({ success: false, error: 'Required fields missing.', required: ['product', 'quantity', 'unit_price'] });
    }
    const result = await pool.query(
      `INSERT INTO sales (sale_date, product, category, region, customer, quantity, unit_price, unit_cost, salesperson, payment, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [sale_date || new Date().toISOString().split('T')[0], product, category, region, customer,
       parseInt(quantity), parseFloat(unit_price), parseFloat(unit_cost || 0), salesperson, payment || 'Cash', company_id]
    );
    await pool.query(
      `UPDATE inventory SET quantity_in_stock = GREATEST(quantity_in_stock - $1, 0), updated_at = NOW()
       WHERE LOWER(product) = LOWER($2) AND company_id = $3`,
      [quantity, product, company_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/inventory', apiKeyAuth, async (req, res) => {
  try {
    const company_id = req.company_id;
    const { category, low_stock } = req.query;
    let query = `SELECT * FROM inventory WHERE company_id = $1`;
    const params = [company_id];
    let p = 1;
    if (category) { p++; query += ` AND LOWER(category) = LOWER($${p})`; params.push(category); }
    if (low_stock === 'true') { query += ` AND quantity_in_stock <= reorder_level`; }
    query += ` ORDER BY product ASC`;
    const result = await pool.query(query, params);
    res.json({ success: true, count: result.rows.length, data: result.rows, company: req.apiKey.company_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/kpis', apiKeyAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT SUM(quantity * unit_price) AS total_revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS total_profit,
        COUNT(*) AS total_transactions, SUM(quantity) AS total_units_sold,
        ROUND(AVG(unit_price), 2) AS avg_unit_price, MAX(sale_date) AS last_sale_date
      FROM sales WHERE company_id = $1
    `, [req.company_id]);
    res.json({ success: true, data: result.rows[0], company: req.apiKey.company_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/categories', apiKeyAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT category, SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit,
        COUNT(*) AS transactions, SUM(quantity) AS units_sold
      FROM sales WHERE company_id = $1 GROUP BY category ORDER BY revenue DESC
    `, [req.company_id]);
    res.json({ success: true, count: result.rows.length, data: result.rows, company: req.apiKey.company_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/regions', apiKeyAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT region, SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit,
        COUNT(*) AS transactions, SUM(quantity) AS units_sold
      FROM sales WHERE company_id = $1
      GROUP BY region ORDER BY revenue DESC
    `, [req.company_id]);
    res.json({ success: true, count: result.rows.length, data: result.rows, company: req.apiKey.company_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/monthly', apiKeyAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT TO_CHAR(sale_date, 'YYYY-MM') AS month,
        SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit,
        COUNT(*) AS transactions
      FROM sales WHERE company_id = $1
      GROUP BY TO_CHAR(sale_date, 'YYYY-MM') ORDER BY month ASC
    `, [req.company_id]);
    res.json({ success: true, count: result.rows.length, data: result.rows, company: req.apiKey.company_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  BILLING — ONEKHUSA CHECKOUT
// ══════════════════════════════════════════════════════════

app.get('/api/billing/plans', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT subscription_status, subscription_expires_at, trial_ends_at, daily_sales_count, daily_sales_date
       FROM companies WHERE id = $1`, [company_id]
    );
    const company = result.rows[0];
    const now = new Date();
    const trialEnd = new Date(company.trial_ends_at);
    const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
    const today = new Date().toISOString().split('T')[0];
    const lastDate = company.daily_sales_date ? new Date(company.daily_sales_date).toISOString().split('T')[0] : null;
    const dailyCount = lastDate !== today ? 0 : (company.daily_sales_count || 0);
    res.json({
      success: true,
      data: {
        subscription_status: company.subscription_status,
        trial_ends_at: company.trial_ends_at,
        subscription_expires_at: company.subscription_expires_at,
        days_left: daysLeft, daily_count: dailyCount, daily_limit: 10, plans: PLAN_PRICES
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/billing/checkout', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { plan, months } = req.body;
    if (!PLAN_PRICES[plan]) {
      return res.status(400).json({ success: false, error: 'Invalid plan. Choose starter, professional or enterprise.' });
    }
    const amount = PLAN_PRICES[plan].monthly * (months || 1);
    const reference = generateReference();
    const idempotencyKey = `SAB-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    await pool.query(
      `INSERT INTO billing (company_id, plan, months, amount_mwk, reference_number, status) VALUES ($1,$2,$3,$4,$5,'pending')`,
      [company_id, plan, months || 1, amount, reference]
    );
    const payload = {
      authentication: { apiKey: ONEKHUSA_API_KEY, apiSecret: ONEKHUSA_API_SECRET },
      merchant: { organisationId: ONEKHUSA_ORG_ID, merchantAccountNumber: ONEKHUSA_MERCHANT },
      payment: {
        sourceReferenceNumber: reference,
        description: `SABIAS ${PLAN_PRICES[plan].name} Plan - ${months || 1} Month(s)`,
        amount: amount
      },
      route: {
        successRedirectionUrl: `https://sabiasanalytics.com?payment=success&ref=${reference}`,
        failureRedirectionUrl: `https://sabiasanalytics.com?payment=failed&ref=${reference}`,
        callbackApiUrl: `https://api.sabiasanalytics.com/api/billing/webhook`
      }
    };

    payload.route.callbackApiUrl = 'https://api.sabiasanalytics.com/api/billing/webhook';

    const data = JSON.stringify(payload);
    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.onekhusa.com', port: 443,
        path: '/live/v1/checkout/rtp/initiate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey, 'Content-Length': Buffer.byteLength(data) }
      };
      const req2 = https.request(options, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => resolve({ status: r.statusCode, body }));
      });
      req2.on('error', reject);
      req2.write(data);
      req2.end();
    });
    const responseData = JSON.parse(response.body);
    if (response.status !== 200 || !responseData.paymentTransactionId) {
      return res.status(400).json({ success: false, error: 'Payment initiation failed. Please try again.', details: responseData });
    }
    await pool.query(
      `UPDATE billing SET payment_transaction_id = $1 WHERE reference_number = $2`,
      [responseData.paymentTransactionId, reference]
    );
    const checkoutUrl = `https://checkout.onekhusa.com/requestToPay/initiate?ptid=${responseData.paymentTransactionId}`;
    res.json({ success: true, checkoutUrl, reference, amount, plan, months: months || 1, paymentTransactionId: responseData.paymentTransactionId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/billing/webhook', async (req, res) => {
  try {
    console.log('Webhook received at /api/billing/webhook');
    console.log('Full payload:', JSON.stringify(req.body, null, 2));

    const body = req.body;

    // 1. Check if this is a successful payment
    if (body.ResponseCode !== 'S100' && body.ResponseCode !== 'S') {
      console.log('Not a success response. Code:', body.ResponseCode);
      return res.status(200).send('Webhook received');
    }

    // 2. Extract reference number from correct path
    const reference = body.MetaData?.ReferenceNumber;
    if (!reference) {
      console.error('Missing ReferenceNumber in payload');
      return res.status(200).send('Missing ReferenceNumber');
    }

    console.log('Payment successful for reference:', reference);

    // 3. Find the pending billing record
    const billingResult = await pool.query(
      `SELECT * FROM billing WHERE reference_number = $1 AND status = 'pending'`,
      [reference]
    );

    if (billingResult.rows.length === 0) {
      console.log('No pending billing record found for:', reference);
      return res.status(200).send('Webhook received');
    }

    const billing = billingResult.rows[0];
    console.log('Found billing: Company', billing.company_id, 'Plan', billing.plan);

    // 4. Calculate subscription expiry
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + billing.months);

    // 5. Update company subscription
    await pool.query(
      `UPDATE companies 
       SET subscription_status = 'active', 
           subscription_expires_at = $1, 
           active = true, 
           daily_sales_count = 0, 
           daily_sales_date = CURRENT_DATE 
       WHERE id = $2`,
      [expiresAt, billing.company_id]
    );
    console.log('Company', billing.company_id, 'activated until', expiresAt);

    // 6. Update billing record
    await pool.query(
      `UPDATE billing 
       SET status = 'paid', 
           paid_at = NOW(), 
           onekhusa_transaction_ref = $1 
       WHERE reference_number = $2`,
      [body.TransactionId || 'N/A', reference]
    );
    console.log('Billing', reference, 'marked as paid');

    // 7. Send confirmation email to admin
    try {
      const adminResult = await pool.query(
        `SELECT u.email, u.name, c.name as company_name 
         FROM users u 
         JOIN companies c ON c.id = u.company_id 
         WHERE u.company_id = $1 AND u.role = 'admin' 
         LIMIT 1`,
        [billing.company_id]
      );

      if (adminResult.rows.length > 0) {
        const admin = adminResult.rows[0];
        const html = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF8F0;padding:32px;border-radius:12px;">
            <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;text-align:center;margin-bottom:24px;">
              <div style="color:#FFB800;font-size:28px;font-weight:bold;letter-spacing:4px;">SABIAS</div>
              <div style="color:#FF6B35;font-size:11px;margin-top:4px;">Payment Confirmation</div>
            </div>
            <div style="background:#E8F5E9;border-left:4px solid #2D6A4F;border-radius:10px;padding:20px;margin-bottom:20px;">
              <div style="color:#2D6A4F;font-size:20px;font-weight:bold;margin-bottom:8px;">Payment Successful!</div>
              <div style="color:#333;font-size:14px;">Hi ${admin.name}, your SABIAS subscription for <strong>${admin.company_name}</strong> is now active.</div>
            </div>
            <div style="background:white;border-radius:10px;padding:20px;border-left:4px solid #2D6A4F;margin-bottom:16px;">
              <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Plan: <strong>${billing.plan.toUpperCase()}</strong></div>
              <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Duration: <strong>${billing.months} Month(s)</strong></div>
              <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Amount: <strong>MWK ${new Intl.NumberFormat().format(billing.amount_mwk)}</strong></div>
              <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Expires: <strong>${expiresAt.toLocaleDateString()}</strong></div>
              <div style="color:#3E1F00;font-size:14px;margin:8px 0;">Reference: <strong>${reference}</strong></div>
            </div>
            <div style="background:#3E1F00;border-radius:10px;padding:16px;text-align:center;">
              <a href="https://sabiasanalytics.com" style="color:#FFB800;font-weight:bold;font-size:15px;text-decoration:none;">Login to SABIAS</a>
            </div>
          </div>`;
        sendEmail(admin.email, `SABIAS Subscription Activated — ${admin.company_name}`, html)
          .catch(err => console.error('Confirm email error:', err));
      }
    } catch (emailErr) {
      console.error('Email error:', emailErr.message);
    }

    // 8. Notify you
    try {
      sendEmail('mwandirakings@gmail.com', 
        `New Payment: ${reference} — MWK ${billing.amount_mwk}`,
        `<p><strong>Company ID:</strong> ${billing.company_id}<br>
         <strong>Plan:</strong> ${billing.plan}<br>
         <strong>Amount:</strong> MWK ${billing.amount_mwk}<br>
         <strong>Reference:</strong> ${reference}<br>
         <strong>Transaction ID:</strong> ${body.TransactionId || 'N/A'}</p>`
      ).catch(err => console.error('Notify email error:', err));
    } catch (emailErr) {
      console.error('Notification email error:', emailErr.message);
    }

    // 9. Return 200 OK
    res.status(200).json({ success: true, received: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    console.error('Stack:', err.stack);
    res.status(200).json({ success: false, error: err.message });
  }
});

app.get('/api/billing/status/:reference', protect, async (req, res) => {
  try {
    const { reference } = req.params;
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT * FROM billing WHERE reference_number = $1 AND company_id = $2`, [reference, company_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/billing/history', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT * FROM billing WHERE company_id = $1 ORDER BY created_at DESC`, [company_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/billing/daily-status', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT subscription_status, subscription_expires_at, trial_ends_at, daily_sales_count, daily_sales_date
       FROM companies WHERE id = $1`, [company_id]
    );
    const company = result.rows[0];
    const now = new Date();
    const trialEnd = new Date(company.trial_ends_at);
    const subEnd = company.subscription_expires_at ? new Date(company.subscription_expires_at) : null;
    const trialActive = company.subscription_status === 'trial' && trialEnd > now;
    const subActive = company.subscription_status === 'active' && subEnd && subEnd > now;
    const isFullAccess = trialActive || subActive;
    const today = new Date().toISOString().split('T')[0];
    const lastDate = company.daily_sales_date ? new Date(company.daily_sales_date).toISOString().split('T')[0] : null;
    const dailyCount = lastDate !== today ? 0 : (company.daily_sales_count || 0);
    res.json({
      success: true,
      data: {
        isFullAccess, dailyCount, dailyLimit: 10,
        remaining: isFullAccess ? 'unlimited' : Math.max(0, 10 - dailyCount),
        subscription_status: company.subscription_status
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  DISBURSEMENTS — SUPPLIER PAYMENTS
// ══════════════════════════════════════════════════════════

app.get('/api/disbursements/connectors', protect, adminOnly, async (req, res) => {
  try {
    const token = await getOneKhusaToken();
    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.onekhusa.com', port: 443,
        path: '/live/v1/core/connectors/GetAll', method: 'GET',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      };
      const req = https.request(options, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => resolve(JSON.parse(body)));
      });
      req.on('error', reject);
      req.end();
    });
    res.json({ success: true, data: response });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/disbursements', protect, adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    const company_id = req.user.company_id;
    const { beneficiary_name, beneficiary_account, connector_id, amount, description, payment_type } = req.body;
    if (!beneficiary_name || !beneficiary_account || !connector_id || !amount) {
      return res.status(400).json({
        success: false, error: 'Required fields missing.',
        required: ['beneficiary_name', 'beneficiary_account', 'connector_id', 'amount']
      });
    }
    const reference = generateReference();
    const idempotencyKey = `disb-${company_id}-${reference}-${Date.now()}`;
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO disbursements (company_id, beneficiary_name, beneficiary_account, connector_id,
        amount, description, payment_type, reference_number, status, captured_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
      [company_id, beneficiary_name, beneficiary_account, connector_id,
       amount, description || 'Supplier Payment', payment_type || 'bank', reference, req.user.email]
    );
    await client.query('COMMIT');
    const token = await getOneKhusaToken();
    const payload = JSON.stringify({
      merchantAccountNumber: ONEKHUSA_MERCHANT,
      sourceReferenceNumber: reference,
      beneficiaryName: beneficiary_name,
      beneficiaryAccountNumber: String(beneficiary_account),
      connectorId: parseInt(connector_id),
      transactionAmount: parseFloat(amount),
      transactionDescription: description || 'Supplier Payment',
      capturedBy: 'sabiasadmin@gmail.com'
    });
    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.onekhusa.com', port: 443,
        path: '/live/v1/disbursements/single/add', method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
          'Accept-Language': 'en', 'X-Idempotency-Key': idempotencyKey,
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      const req2 = https.request(options, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(body) }));
      });
      req2.on('error', reject);
      req2.write(payload);
      req2.end();
    });
    const onekhusaRef = response.body.transactionReferenceNumber || null;

    // Auto-approve if submission succeeded
    if (response.body.responseCode === 'S100' && onekhusaRef) {
      const approvePayload = JSON.stringify({
        merchantAccountNumber: ONEKHUSA_MERCHANT,
        transactionReferenceNumber: onekhusaRef,
        actionedBy: 'sabiasadmin@gmail.com'
      });
      const approveKey = `appr-${company_id}-${onekhusaRef}-${Date.now()}`;
      await new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.onekhusa.com', port: 443,
          path: '/live/v1/disbursements/single/approve', method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
            'Accept-Language': 'en', 'X-Idempotency-Key': approveKey,
            'Content-Length': Buffer.byteLength(approvePayload)
          }
        };
        const req3 = https.request(options, (r) => {
          let body = '';
          r.on('data', chunk => body += chunk);
          r.on('end', () => resolve(JSON.parse(body)));
        });
        req3.on('error', reject);
        req3.write(approvePayload);
        req3.end();
      });
    }

    await pool.query(
      `UPDATE disbursements SET onekhusa_ref = $1, status = $2 WHERE reference_number = $3`,
      [onekhusaRef,
       response.body.responseCode === 'S100' ? 'processing' : 'failed', reference]
    );
    res.json({
      success: true, reference,
      onekhusa_ref: onekhusaRef,
      response_code: response.body.responseCode,
      message: response.body.responseCode === 'S100'
        ? 'Disbursement submitted successfully. Awaiting processing.'
        : 'Disbursement submission failed.',
      data: response.body
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/disbursements', protect, adminOnly, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT * FROM disbursements WHERE company_id = $1 ORDER BY created_at DESC`, [company_id]
    );
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/disbursements/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('Disbursement Webhook:', JSON.stringify(body));
    res.json({ success: true, received: true });
    const ref = body.sourceReferenceNumber;
    if (!ref) return;
    const status = body.transactionStatusCode === 'S' ? 'paid' : 'failed';
    await pool.query(
      `UPDATE disbursements SET status = $1, paid_at = NOW() WHERE reference_number = $2`,
      [status, ref]
    );
  } catch (err) {
    console.error('Disbursement webhook error:', err.message);
  }
});

// ══════════════════════════════════════════════════════════
//  POS (POINT OF SALE) ROUTES
// ══════════════════════════════════════════════════════════

// ── GET ACTIVE SESSION ──────────────────────────────────
app.get('/api/pos/sessions/active', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT * FROM pos_sessions 
       WHERE company_id = $1 AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1`,
      [company_id]
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── OPEN SESSION ──────────────────────────────────────────
app.post('/api/pos/sessions/open', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { opening_cash } = req.body;
    
    // Close any open sessions first
    await pool.query(
      `UPDATE pos_sessions SET closed_at = NOW(), status = 'closed'
       WHERE company_id = $1 AND status = 'open'`,
      [company_id]
    );
    
    const result = await pool.query(
      `INSERT INTO pos_sessions (company_id, cashier_id, opening_cash, opened_at, status)
       VALUES ($1, $2, $3, NOW(), 'open') RETURNING *`,
      [company_id, req.user.id, opening_cash || 0]
    );
    
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Open session error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── CLOSE SESSION ─────────────────────────────────────────
app.put('/api/pos/sessions/:id/close', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { closing_cash } = req.body;
    const company_id = req.user.company_id;
    
    // First check if session exists and is open
    const sessionCheck = await pool.query(
      `SELECT * FROM pos_sessions WHERE id = $1 AND company_id = $2 AND status = 'open'`,
      [id, company_id]
    );
    
    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found or already closed' });
    }
    
    // Get session totals
    const totals = await pool.query(
      `SELECT COALESCE(SUM(total), 0) as total_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total ELSE 0 END), 0) as cash_total,
              COALESCE(SUM(CASE WHEN payment_method = 'Airtel Money' THEN total ELSE 0 END), 0) as airtel_total,
              COALESCE(SUM(CASE WHEN payment_method = 'TNM Mpamba' THEN total ELSE 0 END), 0) as tnm_total,
              COALESCE(SUM(CASE WHEN payment_method = 'Bank transfer' THEN total ELSE 0 END), 0) as bank_total,
              COALESCE(SUM(CASE WHEN payment_method = 'Voucher' THEN total ELSE 0 END), 0) as voucher_total,
              COALESCE(SUM(discount), 0) as total_discounts,
              COUNT(*) as total_transactions
       FROM pos_transactions 
       WHERE session_id = $1 AND company_id = $2`,
      [id, company_id]
    );
    
    const result = await pool.query(
      `UPDATE pos_sessions 
       SET closed_at = NOW(), 
           status = 'closed',
           closing_cash = $1,
           total_revenue = $2,
           cash_total = $3,
           airtel_total = $4,
           tnm_total = $5,
           bank_total = $6,
           voucher_total = $7,
           total_discounts = $8,
           total_transactions = $9
       WHERE id = $10 AND company_id = $11
       RETURNING *`,
      [
        closing_cash || 0,
        totals.rows[0].total_revenue || 0,
        totals.rows[0].cash_total || 0,
        totals.rows[0].airtel_total || 0,
        totals.rows[0].tnm_total || 0,
        totals.rows[0].bank_total || 0,
        totals.rows[0].voucher_total || 0,
        totals.rows[0].total_discounts || 0,
        totals.rows[0].total_transactions || 0,
        id, company_id
      ]
    );
    
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Close session error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POS TRANSACTIONS ──────────────────────────────────────

// Record sale
app.post('/api/pos/transactions', protect, noViewer, checkTransactionLimit, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { session_id, items, payment_method, discount, customer_name, customer_phone, offline_reference } = req.body;
    
    if (!session_id || !items || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Session and items required' });
    }
    
    // Calculate totals
    let subtotal = 0;
    for (const item of items) {
      subtotal += item.quantity * item.unit_price;
    }
    const total = subtotal - (parseFloat(discount) || 0);
    const reference = offline_reference || 'POS' + Date.now().toString().slice(-9);
    
    // ── 1. INSERT INTO pos_transactions ──
    const txResult = await pool.query(
      `INSERT INTO pos_transactions 
       (company_id, session_id, cashier_id, reference_number, items, subtotal, discount, total, 
        payment_method, customer_name, customer_phone, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       RETURNING *`,
      [company_id, session_id, req.user.id, reference, JSON.stringify(items), subtotal, discount || 0, total, 
       payment_method || 'Cash', customer_name || 'Walk-in', customer_phone || '']
    );
    
    // ── 2. INSERT INTO sales table (for Analytics, Reports, Forecasting) ──
    for (const item of items) {
      await pool.query(
        `INSERT INTO sales (
          sale_date, product, category, region, customer,
          quantity, unit_price, unit_cost, salesperson, payment, company_id, approval_status
        ) VALUES (
          NOW(), $1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, 'approved'
        )`,
        [
          item.product,
          item.category || 'POS Sale',
          customer_name || 'Walk-in',
          item.quantity,
          item.unit_price,
          item.unit_cost || 0,
          req.user.name || 'POS Cashier',
          payment_method || 'Cash',
          company_id
        ]
      );
    }
    
    // ── 3. UPDATE inventory ──
    for (const item of items) {
      await pool.query(
        `UPDATE inventory SET quantity_in_stock = GREATEST(quantity_in_stock - $1, 0), updated_at = NOW()
         WHERE LOWER(product) = LOWER($2) AND company_id = $3`,
        [item.quantity, item.product, company_id]
      );
    }
    
    // ── 4. UPDATE session transaction count ──
    await pool.query(
      `UPDATE pos_sessions SET total_transactions = total_transactions + 1
       WHERE id = $1`,
      [session_id]
    );
    
    res.json({ 
      success: true, 
      data: txResult.rows[0], 
      reference,
      message: 'Sale recorded and synced to all modules'
    });
    
  } catch (err) {
    console.error('POS transaction error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET TRANSACTIONS ──────────────────────────────────────
app.get('/api/pos/transactions', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { session_id, date } = req.query;
    const user_id = req.user.id;
    const role = req.user.role;
    
    let query = `SELECT * FROM pos_transactions WHERE company_id = $1`;
    const params = [company_id];
    let p = 1;
    
    // If not admin, filter by cashier_id
    if (role !== 'admin') {
      p++; query += ` AND cashier_id = $${p}`;
      params.push(user_id);
    }
    
    if (session_id) {
      p++; query += ` AND session_id = $${p}`;
      params.push(session_id);
    }
    if (date) {
      p++; query += ` AND DATE(created_at) = $${p}`;
      params.push(date);
    }
    
    query += ` ORDER BY created_at DESC`;
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POS SUMMARY ──────────────────────────────────────────
app.get('/api/pos/summary', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const user_id = req.user.id;
    const role = req.user.role;
    
    let query = `
      SELECT COUNT(*) as total_transactions,
              COALESCE(SUM(total), 0) as total_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total ELSE 0 END), 0) as cash_total,
              COALESCE(SUM(CASE WHEN payment_method = 'Airtel Money' THEN total ELSE 0 END), 0) as airtel_total,
              COALESCE(SUM(CASE WHEN payment_method = 'TNM Mpamba' THEN total ELSE 0 END), 0) as tnm_total,
              COALESCE(SUM(CASE WHEN payment_method = 'Bank transfer' THEN total ELSE 0 END), 0) as bank_total,
              COALESCE(SUM(CASE WHEN payment_method = 'Voucher' THEN total ELSE 0 END), 0) as voucher_total,
              COALESCE(SUM(discount), 0) as total_discounts
       FROM pos_transactions 
       WHERE company_id = $1 AND DATE(created_at) = $2
    `;
    const params = [company_id, targetDate];
    
    // If not admin, filter by cashier_id
    if (role !== 'admin') {
      query += ` AND cashier_id = $3`;
      params.push(user_id);
    }
    
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  LOYALTY ROUTES
// ══════════════════════════════════════════════════════════

// Get customer loyalty info
app.get('/api/loyalty/customer', protect, async (req, res) => {
  try {
    const { phone } = req.query;
    const company_id = req.user.company_id;
    
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number required' });
    }
    
    const result = await pool.query(
      `SELECT id, name, phone, points, created_at 
       FROM loyalty_customers 
       WHERE phone = $1 AND company_id = $2`,
      [phone, company_id]
    );
    
    if (result.rows.length === 0) {
      // Create new customer
      const newCustomer = await pool.query(
        `INSERT INTO loyalty_customers (company_id, name, phone, points) 
         VALUES ($1, $2, $3, 0) RETURNING *`,
        [company_id, 'Walk-in', phone]
      );
      return res.json({ success: true, data: newCustomer.rows[0] });
    }
    
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Loyalty customer error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Earn loyalty points
app.post('/api/loyalty/earn', protect, async (req, res) => {
  try {
    const { phone, amount } = req.body;
    const company_id = req.user.company_id;
    
    if (!phone || !amount) {
      return res.status(400).json({ success: false, error: 'Phone and amount required' });
    }
    
    // 1 point per MWK 100 spent
    const pointsToAdd = Math.floor(amount / 100);
    
    const result = await pool.query(
      `UPDATE loyalty_customers 
       SET points = points + $1, updated_at = NOW() 
       WHERE phone = $2 AND company_id = $3 
       RETURNING *`,
      [pointsToAdd, phone, company_id]
    );
    
    if (result.rows.length === 0) {
      // Create customer if not exists
      const newCustomer = await pool.query(
        `INSERT INTO loyalty_customers (company_id, name, phone, points) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [company_id, 'Walk-in', phone, pointsToAdd]
      );
      return res.json({ success: true, data: newCustomer.rows[0] });
    }
    
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Loyalty earn error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  REPRINT RECEIPTS
// ══════════════════════════════════════════════════════════

app.get('/api/pos/receipts', protect, async (req, res) => {
  try {
    const { search } = req.query;
    const company_id = req.user.company_id;
    const user_id = req.user.id;
    const role = req.user.role;
    
    let query = `SELECT * FROM pos_transactions WHERE company_id = $1`;
    const params = [company_id];
    let p = 1;
    
    // If not admin, filter by cashier_id
    if (role !== 'admin') {
      p++; query += ` AND cashier_id = $${p}`;
      params.push(user_id);
    }
    
    if (search) {
      p++; query += ` AND (reference_number ILIKE $${p} OR customer_name ILIKE $${p})`;
      params.push(`%${search}%`);
    }
    
    query += ` ORDER BY created_at DESC LIMIT 50`;
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Reprint search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  BRANCH REPORTS
// ══════════════════════════════════════════════════════════

app.get('/api/pos/branch-reports', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const user_id = req.user.id;
    const role = req.user.role;
    
    let query = `
      SELECT 
        COALESCE(NULLIF(region, ''), 'Unknown') as branch,
        COUNT(*) as transactions,
        COALESCE(SUM(total), 0) as revenue,
        COALESCE(SUM(discount), 0) as discounts
      FROM pos_transactions 
      WHERE company_id = $1
    `;
    const params = [company_id];
    let p = 1;
    
    if (role !== 'admin') {
      p++; query += ` AND cashier_id = $${p}`;
      params.push(user_id);
    }
    
    query += ` GROUP BY region ORDER BY revenue DESC`;
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Branch reports error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  TILL REPORTS
// ══════════════════════════════════════════════════════════

app.get('/api/pos/till-reports', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const user_id = req.user.id;
    const role = req.user.role;
    
    let query = `
      SELECT 
        s.id as till_id,
        u.name as cashier_name,
        COUNT(pt.id) as total_transactions,
        COALESCE(SUM(pt.total), 0) as total_revenue,
        s.status,
        s.opened_at,
        s.closed_at
      FROM pos_sessions s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN pos_transactions pt ON pt.session_id = s.id
      WHERE s.company_id = $1
    `;
    const params = [company_id];
    let p = 1;
    
    if (role !== 'admin') {
      p++; query += ` AND s.cashier_id = $${p}`;
      params.push(user_id);
    }
    
    query += ` GROUP BY s.id, u.name, s.status, s.opened_at, s.closed_at
               ORDER BY s.opened_at DESC LIMIT 20`;
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Till reports error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  RECONCILIATION
// ══════════════════════════════════════════════════════════

app.get('/api/pos/reconciliation', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const user_id = req.user.id;
    const role = req.user.role;
    
    let query = `
      SELECT 
        COALESCE(SUM(total), 0) as expected_cash,
        COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total ELSE 0 END), 0) as actual_cash,
        COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total ELSE 0 END), 0) - COALESCE(SUM(total), 0) as variance
      FROM pos_transactions 
      WHERE company_id = $1
        AND DATE(created_at) = CURRENT_DATE
    `;
    const params = [company_id];
    let p = 1;
    
    if (role !== 'admin') {
      p++; query += ` AND cashier_id = $${p}`;
      params.push(user_id);
    }
    
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows[0] || { expected_cash: 0, actual_cash: 0, variance: 0 } });
  } catch (err) {
    console.error('Reconciliation error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  MULTI-TILL DASHBOARD
// ══════════════════════════════════════════════════════════

app.get('/api/pos/multi-till', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    
    const result = await pool.query(
      `SELECT 
        s.id as till_id,
        u.name as cashier_name,
        s.status,
        s.opened_at,
        s.opening_cash,
        COUNT(pt.id) as total_transactions,
        COALESCE(SUM(pt.total), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN pt.payment_method = 'Cash' THEN pt.total ELSE 0 END), 0) as cash_total
       FROM pos_sessions s
       LEFT JOIN users u ON u.id = s.cashier_id
       LEFT JOIN pos_transactions pt ON pt.session_id = s.id
       WHERE s.company_id = $1 AND s.status = 'open'
       GROUP BY s.id, u.name, s.status, s.opened_at, s.opening_cash
       ORDER BY s.opened_at DESC`,
      [company_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Multi-till error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── START SERVER ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log('=====================================');
  console.log(' SABIAS Multi-Company API v2.0');
  console.log(' Running on port ' + PORT);
  console.log(' Currency: Malawian Kwacha (MWK)');
  console.log('=====================================');
});