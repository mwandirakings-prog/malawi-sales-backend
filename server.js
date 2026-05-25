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
      from: 'SABIAS <onboarding@resend.dev>',
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
const notifyAdminStockAlert = async (item, salesperson,
  sale_date, company_id) => {
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
        <div style="font-family:Arial,sans-serif;max-width:600px;
                    margin:0 auto;background:#FFF8F0;padding:32px;
                    border-radius:12px;">
          <div style="background:#3E1F00;padding:20px 32px;
                      border-radius:10px;text-align:center;
                      margin-bottom:24px;">
            <div style="color:#FFB800;font-size:28px;font-weight:bold;
                        letter-spacing:4px;">SABIAS</div>
            <div style="color:#FF6B35;font-size:11px;margin-top:4px;">
              Stock Alert System
            </div>
          </div>
          <div style="background:#FFEBEE;border-left:4px solid #E53935;
                      border-radius:10px;padding:20px;margin-bottom:20px;">
            <div style="color:#C62828;font-size:20px;font-weight:bold;
                        margin-bottom:8px;">
              OUT OF STOCK ALERT
            </div>
            <div style="color:#333;font-size:14px;line-height:1.6;">
              <strong>${item.product}</strong> is now completely
              out of stock at
              <strong>${admin.company_name}</strong>.
              Immediate action required!
            </div>
          </div>
          <div style="background:white;border-radius:10px;padding:20px;
                      border-left:4px solid #E53935;margin-bottom:16px;">
            <div style="color:#888;font-size:12px;font-weight:bold;
                        margin-bottom:12px;">PRODUCT DETAILS</div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Product: <strong>${item.product}</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Category: <strong>${item.category}</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Current Stock:
              <strong style="color:#C62828;">0 units</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Reorder Level:
              <strong>${reorderLevel} units</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Supplier: <strong>${item.supplier || 'N/A'}</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Last Sale by: <strong>${salesperson}</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Date: <strong>${sale_date}</strong>
            </div>
          </div>
          <div style="background:#3E1F00;border-radius:10px;
                      padding:16px;text-align:center;margin-bottom:16px;">
            <div style="color:#FFB800;font-weight:bold;font-size:14px;">
              Please reorder from ${item.supplier || 'your supplier'}
              immediately to avoid losing sales!
            </div>
          </div>
          <div style="text-align:center;color:#888;font-size:11px;">
            SABIAS Auto Stock Alert · ${admin.company_name}
          </div>
        </div>`;
      sendEmail(
        admin.email,
        `OUT OF STOCK: ${item.product} — ${admin.company_name}`,
        html
      ).catch(err => console.error('Out of stock email error:', err));

    } else if (newStock <= reorderLevel) {
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;
                    margin:0 auto;background:#FFF8F0;padding:32px;
                    border-radius:12px;">
          <div style="background:#3E1F00;padding:20px 32px;
                      border-radius:10px;text-align:center;
                      margin-bottom:24px;">
            <div style="color:#FFB800;font-size:28px;font-weight:bold;
                        letter-spacing:4px;">SABIAS</div>
            <div style="color:#FF6B35;font-size:11px;margin-top:4px;">
              Stock Alert System
            </div>
          </div>
          <div style="background:#FFF8E1;border-left:4px solid #FF8F00;
                      border-radius:10px;padding:20px;margin-bottom:20px;">
            <div style="color:#E65100;font-size:20px;font-weight:bold;
                        margin-bottom:8px;">
              LOW STOCK ALERT
            </div>
            <div style="color:#333;font-size:14px;line-height:1.6;">
              <strong>${item.product}</strong> is running low at
              <strong>${admin.company_name}</strong>.
              Please reorder soon.
            </div>
          </div>
          <div style="background:white;border-radius:10px;padding:20px;
                      border-left:4px solid #FF8F00;margin-bottom:16px;">
            <div style="color:#888;font-size:12px;font-weight:bold;
                        margin-bottom:12px;">PRODUCT DETAILS</div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Product: <strong>${item.product}</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Category: <strong>${item.category}</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Current Stock:
              <strong style="color:#E65100;">${newStock} units</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Reorder Level:
              <strong>${reorderLevel} units</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Suggested Order:
              <strong>${reorderLevel * 2} units</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Supplier: <strong>${item.supplier || 'N/A'}</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Last Sale by: <strong>${salesperson}</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Date: <strong>${sale_date}</strong>
            </div>
          </div>
          <div style="background:#3E1F00;border-radius:10px;
                      padding:16px;text-align:center;margin-bottom:16px;">
            <div style="color:#FFB800;font-weight:bold;font-size:14px;">
              Consider ordering at least ${reorderLevel * 2} units
              from ${item.supplier || 'your supplier'} soon.
            </div>
          </div>
          <div style="text-align:center;color:#888;font-size:11px;">
            SABIAS Auto Stock Alert · ${admin.company_name}
          </div>
        </div>`;
      sendEmail(
        admin.email,
        `LOW STOCK: ${item.product} — ${admin.company_name}`,
        html
      ).catch(err => console.error('Low stock email error:', err));
    }
  } catch (err) {
    console.error('Stock notification error:', err.message);
  }
};

// ── ONEKHUSA CONFIG ───────────────────────────────────────
const ONEKHUSA_API_KEY = 'sandbox_f-PrOegkW-QjWN2-A_alYFw0IB0MICWdIQ';
const ONEKHUSA_API_SECRET = 'hcobckO0A1DMvbBz_3FfwoOicW4f8QM6NtHyFlaNHfhYFWmNK4XUyjuolb_s';
const ONEKHUSA_ORG_ID = 'Y7VGV77AJDZ6';
const ONEKHUSA_MERCHANT = 78487105;

const PLAN_PRICES = {
  starter:      { monthly: 5000,  name: 'Starter' },
  professional: { monthly: 10000, name: 'Professional' },
  enterprise:   { monthly: 50000, name: 'Enterprise' }
};

const generateReference = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let ref = 'SAB';
  for (let i = 0; i < 10; i++) {
    ref += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ref;
};

// ── TRANSACTION LIMIT MIDDLEWARE ──────────────────────────
const checkTransactionLimit = async (req, res, next) => {
  try {
    const company_id = req.user
      ? req.user.company_id
      : req.company_id;

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
    const subEnd = company.subscription_expires_at
      ? new Date(company.subscription_expires_at) : null;

    const trialActive = company.subscription_status === 'trial'
      && trialEnd > now;
    const subActive = company.subscription_status === 'active'
      && subEnd && subEnd > now;

    // Full access — no limit applied
    if (trialActive || subActive) return next();

    // Reset count if new day
    const today = new Date().toISOString().split('T')[0];
    const lastDate = company.daily_sales_date
      ? new Date(company.daily_sales_date).toISOString().split('T')[0]
      : null;

    if (lastDate !== today) {
      await pool.query(
        `UPDATE companies SET daily_sales_count = 0,
         daily_sales_date = CURRENT_DATE WHERE id = $1`,
        [company_id]
      );
      company.daily_sales_count = 0;
    }

    if (company.daily_sales_count >= 10) {
      return res.status(429).json({
        success: false,
        limited: true,
        message: 'Daily limit of 10 transactions reached. Subscribe to SABIAS for unlimited transactions.',
        daily_count: company.daily_sales_count,
        daily_limit: 10
      });
    }

    // Increment count
    await pool.query(
      `UPDATE companies
       SET daily_sales_count = daily_sales_count + 1,
           daily_sales_date = CURRENT_DATE
       WHERE id = $1`,
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
      `SELECT u.*, c.name as company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE LOWER(u.email) = LOWER($1)
       AND u.active = true`,
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }
    const user = result.rows[0];

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(user.locked_until) - new Date()) / 60000
      );
      return res.status(423).json({
        success: false,
        message: `Account locked due to too many failed attempts. ` +
          `Try again in ${minutesLeft} minute(s) or reset your password.`
      });
    }

    let passwordMatch = false;
    if (user.password && user.password.startsWith('$2')) {
      passwordMatch = await bcrypt.compare(password, user.password);
    } else {
      passwordMatch = (password === user.password);
      if (passwordMatch) {
        const hashed = await bcrypt.hash(password, 10);
        await pool.query(
          'UPDATE users SET password = $1 WHERE id = $2',
          [hashed, user.id]
        );
      }
    }

    if (!passwordMatch) {
      const attempts = (user.login_attempts || 0) + 1;
      if (attempts >= 5) {
        const lockUntil = new Date(Date.now() + 30 * 60 * 1000);
        await pool.query(
          `UPDATE users SET login_attempts = $1, locked_until = $2
           WHERE id = $3`,
          [attempts, lockUntil, user.id]
        );
        return res.status(423).json({
          success: false,
          message: 'Account locked for 30 minutes due to 5 failed ' +
            'login attempts. Please reset your password or try again later.'
        });
      } else {
        await pool.query(
          'UPDATE users SET login_attempts = $1 WHERE id = $2',
          [attempts, user.id]
        );
        return res.status(401).json({
          success: false,
          message: `Invalid email or password. ` +
            `${5 - attempts} attempt(s) remaining before account is locked.`
        });
      }
    }

    await pool.query(
      `UPDATE users SET login_attempts = 0, locked_until = NULL
       WHERE id = $1`,
      [user.id]
    );

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        company_id: user.company_id,
        region: user.region,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        region: user.region,
        company_id: user.company_id,
        company: user.company_name || 'SABIAS',
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
      `SELECT * FROM users
       WHERE LOWER(email) = LOWER($1) AND active = true`,
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No account found with this email address.'
      });
    }
    const user = result.rows[0];
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        role: user.role,
        error: 'Contact your admin to reset your password.'
      });
    }
    const token = Math.random().toString(36).slice(2) +
                  Math.random().toString(36).slice(2);
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      `UPDATE users SET reset_token = $1, reset_token_expiry = $2,
       login_attempts = 0, locked_until = NULL
       WHERE LOWER(email) = LOWER($3)`,
      [token, expiry, email]
    );
    const resetLink = `https://www.sabiasanalytics.com?reset=${token}`;
    const resetHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;
                  margin:0 auto;background:#FFF8F0;padding:32px;
                  border-radius:12px;">
        <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;
                    text-align:center;margin-bottom:24px;">
          <div style="color:#FFB800;font-size:28px;font-weight:bold;
                      letter-spacing:4px;">SABIAS</div>
          <div style="color:#FF6B35;font-size:11px;margin-top:4px;">
            Sales & Business Intelligence Analytics System
          </div>
        </div>
        <h2 style="color:#3E1F00;margin:0 0 8px;">Password Reset Request</h2>
        <p style="color:#555;font-size:14px;line-height:1.6;">
          Hi ${user.name}, click below to reset your SABIAS password.
          This link expires in 1 hour.
        </p>
        <div style="background:#3E1F00;border-radius:10px;padding:16px;
                    text-align:center;margin:24px 0;">
          <a href="${resetLink}"
             style="color:#FFB800;font-weight:bold;font-size:15px;
                    text-decoration:none;">
            Reset My Password
          </a>
        </div>
        <div style="background:white;border-radius:10px;padding:16px;
                    border-left:4px solid #FF6B35;margin-bottom:20px;">
          <div style="color:#888;font-size:12px;margin-bottom:4px;
                      font-weight:bold;">SECURITY NOTICE</div>
          <div style="color:#555;font-size:13px;">
            If you did not request this, please ignore this email.
            Your password will not change.
          </div>
        </div>
        <p style="color:#888;font-size:12px;">
          Or copy this link:<br/>
          <a href="${resetLink}" style="color:#FF6B35;">${resetLink}</a>
        </p>
        <div style="text-align:center;color:#888;font-size:12px;
                    margin-top:20px;">
          <strong style="color:#3E1F00;">Kings Mwandira</strong><br/>
          CEO, SABIAS
        </div>
      </div>`;
    sendEmail(email, 'SABIAS Password Reset Request', resetHtml)
      .catch(err => console.error('Reset email error:', err));
    res.json({
      success: true,
      message: 'Password reset link sent to your email address.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── RESET PASSWORD ────────────────────────────────────────
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT * FROM users
       WHERE reset_token = $1
       AND reset_token_expiry > NOW()
       AND active = true`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Reset link is invalid or expired. Please request a new one.'
      });
    }
    const user = result.rows[0];
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE users SET password = $1,
       reset_token = NULL, reset_token_expiry = NULL,
       login_attempts = 0, locked_until = NULL
       WHERE id = $2`,
      [hashedPassword, user.id]
    );
    res.json({
      success: true,
      message: 'Password reset successfully! You can now login.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── COMPANY REGISTRATION ──────────────────────────────────
app.post('/api/companies/register', registerLimiter, async (req, res) => {
  const { company_name, email, phone, city, address,
          admin_name, password } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id FROM companies WHERE LOWER(email) = LOWER($1)', [email]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'A company with this email already exists!'
      });
    }
    const compResult = await client.query(
      `INSERT INTO companies (name, email, phone, city, address)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [company_name, email, phone, city, address]
    );
    const company = compResult.rows[0];
    const hashedPassword = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO users
       (name, email, password, role, region, company_id, active)
       VALUES ($1,$2,$3,'admin','all',$4, true)`,
      [admin_name, email, hashedPassword, company.id]
    );
    await client.query('COMMIT');

    const welcomeHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;
                  margin:0 auto;background:#FFF8F0;padding:32px;
                  border-radius:12px;">
        <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;
                    text-align:center;margin-bottom:24px;">
          <div style="color:#FFB800;font-size:28px;font-weight:bold;
                      letter-spacing:4px;">SABIAS</div>
          <div style="color:#FF6B35;font-size:11px;margin-top:4px;">
            Sales & Business Intelligence Analytics System
          </div>
        </div>
        <h2 style="color:#3E1F00;margin:0 0 8px;">Hi ${admin_name},</h2>
        <p style="color:#555;font-size:15px;line-height:1.6;">
          Welcome to <strong>SABIAS</strong>! Your company
          <strong style="color:#FF6B35;">${company_name}</strong>
          has been successfully registered on our platform.
        </p>
        <div style="background:white;border-radius:10px;padding:20px;
                    margin:20px 0;border-left:4px solid #FF6B35;">
          <div style="color:#888;font-size:12px;margin-bottom:8px;
                      font-weight:bold;">YOUR REGISTRATION DETAILS</div>
          <div style="color:#3E1F00;font-size:14px;margin:6px 0;">
            Email: <strong>${email}</strong>
          </div>
          <div style="color:#3E1F00;font-size:14px;margin:6px 0;">
            Company: <strong>${company_name}</strong>
          </div>
          <div style="color:#3E1F00;font-size:14px;margin:6px 0;">
            District: <strong>${city}</strong>
          </div>
          <div style="color:#3E1F00;font-size:14px;margin:6px 0;">
            Admin: <strong>${admin_name}</strong>
          </div>
        </div>
        <p style="color:#555;font-size:14px;line-height:1.6;">
          You can now login at
          <a href="https://www.sabiasanalytics.com"
             style="color:#FF6B35;font-weight:bold;">
            www.sabiasanalytics.com
          </a>
        </p>
        <div style="background:#3E1F00;border-radius:10px;padding:16px;
                    text-align:center;margin-top:24px;">
          <a href="https://www.sabiasanalytics.com"
             style="color:#FFB800;font-weight:bold;font-size:15px;
                    text-decoration:none;">
            Login to SABIAS
          </a>
        </div>
        <div style="text-align:center;margin-top:24px;color:#888;
                    font-size:12px;">
          <strong style="color:#3E1F00;">Kings Mwandira</strong><br/>
          CEO, SABIAS
        </div>
      </div>`;

    const notifyHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;
                  margin:0 auto;background:#FFF8F0;padding:32px;
                  border-radius:12px;">
        <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;
                    text-align:center;margin-bottom:24px;">
          <div style="color:#FFB800;font-size:28px;font-weight:bold;
                      letter-spacing:4px;">SABIAS</div>
          <div style="color:#FF6B35;font-size:11px;margin-top:4px;">
            New Company Registration Alert
          </div>
        </div>
        <h2 style="color:#3E1F00;">New Company Registered!</h2>
        <p style="color:#555;font-size:14px;">
          A new business has just joined SABIAS:
        </p>
        <div style="background:white;border-radius:10px;padding:20px;
                    margin:20px 0;border-left:4px solid #2D6A4F;">
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
            Company: <strong>${company_name}</strong>
          </div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
            Admin: <strong>${admin_name}</strong>
          </div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
            Email: <strong>${email}</strong>
          </div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
            Phone: <strong>${phone}</strong>
          </div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
            District: <strong>${city}</strong>
          </div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
            Address: <strong>${address || 'Not provided'}</strong>
          </div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
            Registered: <strong>${new Date().toLocaleString()}</strong>
          </div>
        </div>
        <p style="color:#555;font-size:13px;">
          Call <strong>${phone}</strong> to follow up.
        </p>
        <div style="text-align:center;margin-top:16px;
                    color:#888;font-size:11px;">
          SABIAS Auto-Notification System
        </div>
      </div>`;

    sendEmail(email, `Welcome to SABIAS, ${admin_name}!`, welcomeHtml)
      .catch(err => console.error('Welcome email error:', err));
    sendEmail('mwandirakings@gmail.com',
      `New SABIAS Registration: ${company_name}`, notifyHtml)
      .catch(err => console.error('Notify email error:', err));

    res.json({
      success: true,
      message: 'Company registered successfully!',
      company_id: company.id,
      company_name: company.name
    });
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
      `SELECT c.*, COUNT(u.id) as user_count
       FROM companies c
       LEFT JOIN users u ON u.company_id = c.id
       WHERE c.id = $1
       GROUP BY c.id`,
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
    const result = await pool.query(
      `SELECT * FROM sales WHERE company_id = $1
       ORDER BY sale_date DESC`,
      [company_id]
    );
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SALES — POST (with daily limit check) ─────────────────
app.post('/api/sales', protect, noViewer, checkTransactionLimit,
  async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { sale_date, product, category, region, customer,
            quantity, unit_price, unit_cost, salesperson, payment } = req.body;

    const result = await pool.query(
      `INSERT INTO sales
       (sale_date, product, category, region, customer,
        quantity, unit_price, unit_cost, salesperson, payment, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [sale_date, product, category, region, customer,
       quantity, unit_price, unit_cost, salesperson, payment, company_id]
    );

    const invResult = await pool.query(
      `UPDATE inventory
       SET quantity_in_stock = GREATEST(quantity_in_stock - $1, 0),
           updated_at = NOW()
       WHERE LOWER(product) = LOWER($2) AND company_id = $3
       RETURNING *`,
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

// ── KPI SUMMARY ───────────────────────────────────────────
app.get('/api/kpis', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(`
      SELECT
        SUM(quantity * unit_price) AS total_revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS total_profit,
        COUNT(*) AS total_records,
        SUM(quantity) AS total_units,
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
      SELECT region,
        SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit,
        COUNT(*) AS records
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
      SELECT category,
        SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit,
        COUNT(*) AS records
      FROM sales WHERE company_id = $1
      GROUP BY category ORDER BY revenue DESC
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
      SELECT
        TO_CHAR(sale_date, 'YYYY-MM') AS month,
        SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit,
        COUNT(*) AS records
      FROM sales WHERE company_id = $1
      GROUP BY TO_CHAR(sale_date, 'YYYY-MM')
      ORDER BY month ASC
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
      SELECT
        COUNT(*) as total_products,
        SUM(quantity_in_stock) as total_units,
        SUM(quantity_in_stock * unit_cost) as total_cost_value,
        SUM(quantity_in_stock * unit_price) as total_retail_value,
        COUNT(CASE WHEN quantity_in_stock = 0 THEN 1 END) as out_of_stock,
        COUNT(CASE WHEN quantity_in_stock > 0
              AND quantity_in_stock <= reorder_level THEN 1 END) as low_stock
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
      `SELECT * FROM inventory WHERE company_id = $1
       ORDER BY product ASC`,
      [company_id]
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
    const { product, category, unit_price, unit_cost,
            quantity_in_stock, reorder_level, supplier } = req.body;
    const result = await pool.query(
      `INSERT INTO inventory
       (product, category, unit_price, unit_cost,
        quantity_in_stock, reorder_level, supplier, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [product, category, unit_price, unit_cost,
       quantity_in_stock, reorder_level, supplier, company_id]
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
    const { quantity_in_stock, unit_price, unit_cost,
            reorder_level, supplier } = req.body;
    const result = await pool.query(
      `UPDATE inventory SET
       quantity_in_stock=$1, unit_price=$2, unit_cost=$3,
       reorder_level=$4, supplier=$5, updated_at=NOW()
       WHERE id=$6 AND company_id=$7 RETURNING *`,
      [quantity_in_stock, unit_price, unit_cost,
       reorder_level, supplier, id, company_id]
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
    await pool.query(
      'DELETE FROM inventory WHERE id=$1 AND company_id=$2',
      [id, company_id]
    );
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
      `SELECT id, name, email, role, region, active,
       company_id, created_at FROM users
       WHERE company_id = $1 ORDER BY created_at DESC`,
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
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, email, role, region, active`,
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
       WHERE id=$5 AND company_id=$6
       RETURNING id, name, email, role, region, active`,
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
      `UPDATE users SET password=$1,
       login_attempts=0, locked_until=NULL
       WHERE id=$2 AND company_id=$3`,
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
    await pool.query(
      'DELETE FROM users WHERE id=$1 AND company_id=$2',
      [id, company_id]
    );
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN MIDDLEWARE ────────────────────────────────
const superAdminOnly = (req, res, next) => {
  if (req.user.email !== 'sabiascustomercare@gmail.com') {
    return res.status(403).json({
      success: false,
      message: 'Super Admin access required.'
    });
  }
  next();
};

// ── SUPER ADMIN — GET ALL COMPANIES ──────────────────────
app.get('/api/superadmin/companies', protect, superAdminOnly,
  async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.name, c.email, c.phone, c.city, c.country,
        c.active, c.plan, c.created_at, c.trial_ends_at,
        c.subscription_status, c.subscription_expires_at,
        COUNT(u.id) as user_count,
        NOW() as current_time
      FROM companies c
      LEFT JOIN users u ON u.company_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN — TOGGLE COMPANY ACTIVE ──────────────────
app.put('/api/superadmin/companies/:id/toggle',
  protect, superAdminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE companies SET active = NOT active
       WHERE id = $1 RETURNING *`,
      [id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN — EXTEND TRIAL ────────────────────────────
app.put('/api/superadmin/companies/:id/extend',
  protect, superAdminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { days } = req.body;
    const result = await pool.query(
      `UPDATE companies
       SET trial_ends_at = GREATEST(trial_ends_at, NOW())
         + INTERVAL '1 day' * $1,
           subscription_status = 'trial',
           active = true
       WHERE id = $2 RETURNING *`,
      [days || 7, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN — ACTIVATE SUBSCRIPTION ──────────────────
app.put('/api/superadmin/companies/:id/activate',
  protect, superAdminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { months } = req.body;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + (months || 1));
    const result = await pool.query(
      `UPDATE companies
       SET subscription_status = 'active',
           subscription_expires_at = $1,
           active = true
       WHERE id = $2 RETURNING *`,
      [expiresAt, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SUPER ADMIN — DELETE COMPANY ──────────────────────────
app.delete('/api/superadmin/companies/:id',
  protect, superAdminOnly, async (req, res) => {
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

// ── TRIAL STATUS ──────────────────────────────────────────
app.get('/api/trial/status', protect, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT active, trial_ends_at, subscription_status,
              subscription_expires_at, daily_sales_count,
              daily_sales_date, NOW() as current_time
       FROM companies WHERE id = $1`,
      [company_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false, message: 'Company not found'
      });
    }
    const company = result.rows[0];
    const now = new Date();
    const trialEnd = new Date(company.trial_ends_at);
    const subEnd = company.subscription_expires_at
      ? new Date(company.subscription_expires_at) : null;
    const daysLeftTrial = Math.ceil(
      (trialEnd - now) / (1000 * 60 * 60 * 24)
    );
    const daysLeftSub = subEnd
      ? Math.ceil((subEnd - now) / (1000 * 60 * 60 * 24))
      : null;

    const today = new Date().toISOString().split('T')[0];
    const lastDate = company.daily_sales_date
      ? new Date(company.daily_sales_date).toISOString().split('T')[0]
      : null;
    const dailyCount = lastDate !== today
      ? 0 : (company.daily_sales_count || 0);

    let status = 'active';
    let daysLeft = null;
    let message = '';
    let limited = false;

    if (company.subscription_status === 'trial') {
      if (daysLeftTrial <= 0) {
        status = 'limited';
        limited = true;
        message = `Free trial ended. You have ${Math.max(0, 10 - dailyCount)} transactions left today. Subscribe for unlimited access.`;
      } else if (daysLeftTrial <= 3) {
        status = 'trial_warning';
        daysLeft = daysLeftTrial;
        message = `Trial expires in ${daysLeftTrial} day(s)! Subscribe to keep unlimited access.`;
      } else {
        status = 'trial';
        daysLeft = daysLeftTrial;
        message = `Free trial — ${daysLeftTrial} day(s) remaining.`;
      }
    } else if (company.subscription_status === 'active') {
      if (daysLeftSub !== null && daysLeftSub <= 0) {
        status = 'limited';
        limited = true;
        message = `Subscription ended. You have ${Math.max(0, 10 - dailyCount)} transactions left today. Renew to restore unlimited access.`;
      } else if (daysLeftSub !== null && daysLeftSub <= 3) {
        status = 'sub_warning';
        daysLeft = daysLeftSub;
        message = `Subscription expires in ${daysLeftSub} day(s)! Renew to avoid limits.`;
      } else {
        status = 'active';
        daysLeft = daysLeftSub;
      }
    }

    res.json({
      success: true,
      data: {
        status,
        limited,
        daysLeft,
        message,
        dailyCount,
        dailyLimit: 10,
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
    if (!authHeader || !authHeader.startsWith('Bearer sk_live_sabias_')) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or missing API key.',
        hint: 'Include your API key in the Authorization header: Bearer sk_live_sabias_xxxx'
      });
    }
    const keyValue = authHeader.replace('Bearer ', '').trim();
    const result = await pool.query(
      `SELECT ak.*, c.name as company_name, c.active as company_active
       FROM api_keys ak
       JOIN companies c ON c.id = ak.company_id
       WHERE ak.key_value = $1 AND ak.active = true`,
      [keyValue]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'API key not found or has been revoked.'
      });
    }
    const apiKey = result.rows[0];
    if (!apiKey.company_active) {
      return res.status(403).json({
        success: false,
        error: 'Your company account is inactive. Contact SABIAS support.'
      });
    }
    if (apiKey.requests_today >= 1000) {
      return res.status(429).json({
        success: false,
        error: 'Daily request limit reached (1000/day). Limit resets at midnight.',
        requests_today: apiKey.requests_today,
        limit: 1000
      });
    }
    await pool.query(
      `UPDATE api_keys
       SET requests_today = requests_today + 1,
           requests_total = requests_total + 1,
           last_used_at = NOW()
       WHERE id = $1`,
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
const generateApiKey = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'sk_live_sabias_';
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
      `SELECT id, name, key_value, active,
              requests_today, requests_total,
              last_used_at, created_at
       FROM api_keys WHERE company_id = $1
       ORDER BY created_at DESC`,
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
    const { name } = req.body;
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM api_keys WHERE company_id = $1 AND active = true',
      [company_id]
    );
    if (parseInt(countResult.rows[0].count) >= 3) {
      return res.status(400).json({
        success: false,
        error: 'Maximum of 3 active API keys allowed per company.'
      });
    }
    const keyValue = generateApiKey();
    const result = await pool.query(
      `INSERT INTO api_keys (company_id, name, key_value)
       VALUES ($1, $2, $3) RETURNING *`,
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
    await pool.query(
      `UPDATE api_keys SET active = false
       WHERE id = $1 AND company_id = $2`,
      [id, company_id]
    );
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
    res.json({ success: true, count: result.rows.length,
      page: parseInt(page), limit: parseInt(limit),
      data: result.rows, company: req.apiKey.company_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── v1 POST SALE (with daily limit) ──────────────────────
app.post('/api/v1/sales', apiKeyAuth, checkTransactionLimit,
  async (req, res) => {
  try {
    const company_id = req.company_id;
    const { sale_date, product, category, region, customer,
            quantity, unit_price, unit_cost, salesperson, payment } = req.body;
    if (!product || !quantity || !unit_price) {
      return res.status(400).json({
        success: false, error: 'Required fields missing.',
        required: ['product', 'quantity', 'unit_price']
      });
    }
    const result = await pool.query(
      `INSERT INTO sales
       (sale_date, product, category, region, customer,
        quantity, unit_price, unit_cost, salesperson, payment, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [sale_date || new Date().toISOString().split('T')[0],
       product, category, region, customer,
       parseInt(quantity), parseFloat(unit_price),
       parseFloat(unit_cost || 0), salesperson, payment || 'Cash',
       company_id]
    );
    await pool.query(
      `UPDATE inventory
       SET quantity_in_stock = GREATEST(quantity_in_stock - $1, 0),
           updated_at = NOW()
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
    res.json({ success: true, count: result.rows.length,
      data: result.rows, company: req.apiKey.company_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/kpis', apiKeyAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT SUM(quantity * unit_price) AS total_revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS total_profit,
        COUNT(*) AS total_transactions,
        SUM(quantity) AS total_units_sold,
        ROUND(AVG(unit_price), 2) AS avg_unit_price,
        MAX(sale_date) AS last_sale_date
      FROM sales WHERE company_id = $1
    `, [req.company_id]);
    res.json({ success: true, data: result.rows[0],
      company: req.apiKey.company_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/categories', apiKeyAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT category,
        SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit,
        COUNT(*) AS transactions, SUM(quantity) AS units_sold
      FROM sales WHERE company_id = $1
      GROUP BY category ORDER BY revenue DESC
    `, [req.company_id]);
    res.json({ success: true, count: result.rows.length,
      data: result.rows, company: req.apiKey.company_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/regions', apiKeyAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT region,
        SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit,
        COUNT(*) AS transactions, SUM(quantity) AS units_sold
      FROM sales WHERE company_id = $1
      GROUP BY region ORDER BY revenue DESC
    `, [req.company_id]);
    res.json({ success: true, count: result.rows.length,
      data: result.rows, company: req.apiKey.company_name });
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
      GROUP BY TO_CHAR(sale_date, 'YYYY-MM')
      ORDER BY month ASC
    `, [req.company_id]);
    res.json({ success: true, count: result.rows.length,
      data: result.rows, company: req.apiKey.company_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1', apiKeyAuth, async (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to SABIAS Public API v1',
    company: req.apiKey.company_name,
    api_key_name: req.apiKey.name,
    requests_today: req.apiKey.requests_today,
    requests_total: req.apiKey.requests_total,
    daily_limit: 1000,
    endpoints: {
      'GET /api/v1/sales': 'Get all sales',
      'POST /api/v1/sales': 'Record a new sale',
      'GET /api/v1/inventory': 'Get all products',
      'GET /api/v1/kpis': 'Get revenue and profit totals',
      'GET /api/v1/categories': 'Sales by category',
      'GET /api/v1/regions': 'Sales by region',
      'GET /api/v1/monthly': 'Monthly revenue trend',
    },
    documentation: 'https://info.sabiasanalytics.com/api-docs.html',
    support: 'sabiascustomercare@gmail.com'
  });
});

// ── SUPER ADMIN — GET API KEYS FOR COMPANY ────────────────
app.get('/api/superadmin/companies/:id/apikeys',
  protect, superAdminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, name, key_value, active,
              requests_today, requests_total,
              last_used_at, created_at
       FROM api_keys WHERE company_id = $1
       ORDER BY created_at DESC`,
      [id]
    );
    res.json({ success: true, data: result.rows });
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
      `SELECT subscription_status, subscription_expires_at,
              trial_ends_at, daily_sales_count, daily_sales_date
       FROM companies WHERE id = $1`,
      [company_id]
    );
    const company = result.rows[0];
    const now = new Date();
    const trialEnd = new Date(company.trial_ends_at);
    const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
    const today = new Date().toISOString().split('T')[0];
    const lastDate = company.daily_sales_date
      ? new Date(company.daily_sales_date).toISOString().split('T')[0]
      : null;
    const dailyCount = lastDate !== today
      ? 0 : (company.daily_sales_count || 0);
    res.json({
      success: true,
      data: {
        subscription_status: company.subscription_status,
        trial_ends_at: company.trial_ends_at,
        subscription_expires_at: company.subscription_expires_at,
        days_left: daysLeft,
        daily_count: dailyCount,
        daily_limit: 10,
        plans: PLAN_PRICES
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
      return res.status(400).json({
        success: false,
        error: 'Invalid plan. Choose starter, professional or enterprise.'
      });
    }

    const amount = PLAN_PRICES[plan].monthly * (months || 1);
    const reference = generateReference();
    const idempotencyKey = `${company_id}-${reference}-${Date.now()}`;

    await pool.query(
      `INSERT INTO billing
       (company_id, plan, months, amount_mwk, reference_number, status)
       VALUES ($1,$2,$3,$4,$5,'pending')`,
      [company_id, plan, months || 1, amount, reference]
    );

    const payload = {
      authentication: {
        apiKey: ONEKHUSA_API_KEY,
        apiSecret: ONEKHUSA_API_SECRET
      },
      merchant: {
        organisationId: ONEKHUSA_ORG_ID,
        merchantAccountNumber: ONEKHUSA_MERCHANT
      },
      payment: {
        sourceReferenceNumber: reference,
        description: `SABIAS ${PLAN_PRICES[plan].name} Plan - ${months || 1} Month(s)`,
        amount: amount
      },
      route: {
        successRedirectionUrl: `https://sabiasanalytics.com?payment=success&ref=${reference}`,
        failureRedirectionUrl: `https://sabiasanalytics.com?payment=failed&ref=${reference}`,
        callbackApiUrl: `https://malawi-sales-backend.onrender.com/api/billing/webhook`
      }
    };

    const data = JSON.stringify(payload);

    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.onekhusa.com',
        port: 443,
        path: '/sandbox/v1/checkout/rtp/initiate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
          'Content-Length': Buffer.byteLength(data)
        }
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
      return res.status(400).json({
        success: false,
        error: 'Payment initiation failed. Please try again.',
        details: responseData
      });
    }

    await pool.query(
      `UPDATE billing SET payment_transaction_id = $1
       WHERE reference_number = $2`,
      [responseData.paymentTransactionId, reference]
    );

    const checkoutUrl = `https://checkout.onekhusa.com/requestToPay/initiate?ptid=${responseData.paymentTransactionId}`;

    res.json({
      success: true,
      checkoutUrl,
      reference,
      amount,
      plan,
      months: months || 1,
      paymentTransactionId: responseData.paymentTransactionId
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── WEBHOOK — OneKhusa notifies us after payment ──────────
app.post('/api/billing/webhook', async (req, res) => {
  try {
    const event = req.headers['x-onekhusa-webhook-event'];
    const body = req.body;
    console.log('OneKhusa Webhook:', event, JSON.stringify(body));

    // Acknowledge immediately
    res.json({ success: true, received: true });

    if (event !== 'payrequest.success' && event !== 'payment.success') return;
    if (body.transactionStatusCode !== 'S') return;

    const reference = body.metaData?.referenceNumber
      || body.sourceReferenceNumber;
    if (!reference) return;

    const billingResult = await pool.query(
      `SELECT * FROM billing
       WHERE reference_number = $1 AND status = 'pending'`,
      [reference]
    );
    if (billingResult.rows.length === 0) return;
    const billing = billingResult.rows[0];

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + billing.months);

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

    await pool.query(
      `UPDATE billing SET status = 'paid', paid_at = NOW(),
       onekhusa_transaction_ref = $1
       WHERE reference_number = $2`,
      [body.transactionReferenceNumber || 'N/A', reference]
    );

    const adminResult = await pool.query(
      `SELECT u.email, u.name, c.name as company_name
       FROM users u JOIN companies c ON c.id = u.company_id
       WHERE u.company_id = $1 AND u.role = 'admin' LIMIT 1`,
      [billing.company_id]
    );

    if (adminResult.rows.length > 0) {
      const admin = adminResult.rows[0];
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;
                    margin:0 auto;background:#FFF8F0;padding:32px;
                    border-radius:12px;">
          <div style="background:#3E1F00;padding:20px 32px;
                      border-radius:10px;text-align:center;
                      margin-bottom:24px;">
            <div style="color:#FFB800;font-size:28px;font-weight:bold;
                        letter-spacing:4px;">SABIAS</div>
            <div style="color:#FF6B35;font-size:11px;margin-top:4px;">
              Payment Confirmation
            </div>
          </div>
          <div style="background:#E8F5E9;border-left:4px solid #2D6A4F;
                      border-radius:10px;padding:20px;margin-bottom:20px;">
            <div style="color:#2D6A4F;font-size:20px;font-weight:bold;
                        margin-bottom:8px;">Payment Successful!</div>
            <div style="color:#333;font-size:14px;line-height:1.6;">
              Hi ${admin.name}, your SABIAS subscription for
              <strong>${admin.company_name}</strong> is now active.
            </div>
          </div>
          <div style="background:white;border-radius:10px;padding:20px;
                      border-left:4px solid #2D6A4F;margin-bottom:16px;">
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Plan: <strong>${billing.plan.toUpperCase()}</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Duration: <strong>${billing.months} Month(s)</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Amount: <strong>MWK ${new Intl.NumberFormat().format(billing.amount_mwk)}</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Expires: <strong>${expiresAt.toLocaleDateString()}</strong>
            </div>
            <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
              Reference: <strong>${reference}</strong>
            </div>
          </div>
          <div style="background:#3E1F00;border-radius:10px;padding:16px;
                      text-align:center;">
            <a href="https://sabiasanalytics.com"
               style="color:#FFB800;font-weight:bold;font-size:15px;
                      text-decoration:none;">Login to SABIAS</a>
          </div>
        </div>`;

      sendEmail(
        admin.email,
        `SABIAS Subscription Activated — ${admin.company_name}`,
        html
      ).catch(err => console.error('Confirm email error:', err));

      sendEmail(
        'mwandirakings@gmail.com',
        `New Payment: ${admin.company_name} — MWK ${billing.amount_mwk}`,
        `<p><strong>${admin.company_name}</strong> paid MWK ${billing.amount_mwk} for ${billing.plan} plan (${billing.months} month/s). Ref: ${reference}</p>`
      ).catch(err => console.error('Notify email error:', err));
    }

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

app.get('/api/billing/status/:reference', protect, async (req, res) => {
  try {
    const { reference } = req.params;
    const company_id = req.user.company_id;
    const result = await pool.query(
      `SELECT * FROM billing
       WHERE reference_number = $1 AND company_id = $2`,
      [reference, company_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false, error: 'Record not found'
      });
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
      `SELECT * FROM billing WHERE company_id = $1
       ORDER BY created_at DESC`,
      [company_id]
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
      `SELECT subscription_status, subscription_expires_at,
              trial_ends_at, daily_sales_count, daily_sales_date
       FROM companies WHERE id = $1`,
      [company_id]
    );
    const company = result.rows[0];
    const now = new Date();
    const trialEnd = new Date(company.trial_ends_at);
    const subEnd = company.subscription_expires_at
      ? new Date(company.subscription_expires_at) : null;
    const trialActive = company.subscription_status === 'trial'
      && trialEnd > now;
    const subActive = company.subscription_status === 'active'
      && subEnd && subEnd > now;
    const isFullAccess = trialActive || subActive;
    const today = new Date().toISOString().split('T')[0];
    const lastDate = company.daily_sales_date
      ? new Date(company.daily_sales_date).toISOString().split('T')[0]
      : null;
    const dailyCount = lastDate !== today
      ? 0 : (company.daily_sales_count || 0);
    res.json({
      success: true,
      data: {
        isFullAccess,
        dailyCount,
        dailyLimit: 10,
        remaining: isFullAccess ? 'unlimited' : Math.max(0, 10 - dailyCount),
        subscription_status: company.subscription_status
      }
    });
  } catch (err) {
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
