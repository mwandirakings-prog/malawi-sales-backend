const https = require('https');
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const authRoutes = require('./auth');
app.use('/api/auth', authRoutes);

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

// ── COMPANY REGISTRATION ──────────────────────────────────
app.post('/api/companies/register', async (req, res) => {
  const { company_name, email, phone, city, address,
          admin_name, password } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id FROM companies WHERE email = $1', [email]
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
    await client.query(
      `INSERT INTO users (name, email, password, role, region, company_id, active)
       VALUES ($1,$2,$3,'admin','all',$4, true)`,
      [admin_name, email, password, company.id]
    );
    await client.query('COMMIT');

    // ── Welcome email to new company ──────────────────────
    const welcomeHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;
                  background:#FFF8F0;padding:32px;border-radius:12px;">
        <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;
                    text-align:center;margin-bottom:24px;">
          <div style="color:#FFB800;font-size:28px;font-weight:bold;
                      letter-spacing:4px;">SABIAS</div>
          <div style="color:#FF6B35;font-size:11px;margin-top:4px;">
            Sales & Business Intelligence Analytics System
          </div>
        </div>
        <h2 style="color:#3E1F00;margin:0 0 8px;">
          Hi ${admin_name},
        </h2>
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
          and start recording your sales, managing inventory
          and viewing analytics.
        </p>
        <div style="background:#3E1F00;border-radius:10px;padding:16px;
                    text-align:center;margin-top:24px;">
          <a href="https://www.sabiasanalytics.com"
             style="color:#FFB800;font-weight:bold;font-size:15px;
                    text-decoration:none;">
            Login to SABIAS
          </a>
        </div>
        <div style="text-align:center;margin-top:24px;
                    color:#888;font-size:12px;">
          <p>Need help? Contact your SABIAS administrator.</p>
          <p style="margin-top:8px;">
            <strong style="color:#3E1F00;">Kings Mwandira</strong><br/>
            CEO, SABIAS<br/>
            Sales & Business Intelligence Analytics System
          </p>
        </div>
      </div>
    `;

    // ── Notification email to Kings ───────────────────────
    const notifyHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;
                  background:#FFF8F0;padding:32px;border-radius:12px;">
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
          A new business has just joined SABIAS. Here are their details:
        </p>
        <div style="background:white;border-radius:10px;padding:20px;
                    margin:20px 0;border-left:4px solid #2D6A4F;">
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
            Company: <strong>${company_name}</strong>
          </div>
          <div style="color:#3E1F00;font-size:14px;margin:8px 0;">
            Admin Name: <strong>${admin_name}</strong>
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
          You can call <strong>${phone}</strong> to follow up
          with this client for marketing or support.
        </p>
        <div style="text-align:center;margin-top:16px;
                    color:#888;font-size:11px;">
          SABIAS Auto-Notification System
        </div>
      </div>
    `;

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

// ── FORGOT PASSWORD ───────────────────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1', [email]
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
      `UPDATE users SET reset_token = $1, reset_token_expiry = $2
       WHERE email = $3`,
      [token, expiry, email]
    );

    const resetLink =
      `https://www.sabiasanalytics.com?reset=${token}`;

    const resetHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;
                  background:#FFF8F0;padding:32px;border-radius:12px;">
        <div style="background:#3E1F00;padding:20px 32px;border-radius:10px;
                    text-align:center;margin-bottom:24px;">
          <div style="color:#FFB800;font-size:28px;font-weight:bold;
                      letter-spacing:4px;">SABIAS</div>
          <div style="color:#FF6B35;font-size:11px;margin-top:4px;">
            Sales & Business Intelligence Analytics System
          </div>
        </div>
        <h2 style="color:#3E1F00;margin:0 0 8px;">
          Password Reset Request
        </h2>
        <p style="color:#555;font-size:14px;line-height:1.6;">
          Hi ${user.name}, we received a request to reset the password
          for your SABIAS admin account.
        </p>
        <p style="color:#555;font-size:14px;line-height:1.6;">
          Click the button below to reset your password.
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
            If you did not request this password reset, please ignore
            this email. Your password will remain unchanged.
          </div>
        </div>
        <div style="text-align:center;color:#888;font-size:12px;">
          <p>This link expires in 1 hour for security reasons.</p>
          <p style="margin-top:8px;">
            <strong style="color:#3E1F00;">Kings Mwandira</strong><br/>
            CEO, SABIAS<br/>
            Sales & Business Intelligence Analytics System
          </p>
        </div>
      </div>
    `;

    sendEmail(email, 'SABIAS Password Reset Request', resetHtml)
      .catch(err => console.error('Reset email error:', err));

    res.json({
      success: true,
      message: 'Password reset link sent to your email!'
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
       AND reset_token_expiry > NOW()`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Reset link is invalid or has expired. Please request a new one.'
      });
    }
    await pool.query(
      `UPDATE users
       SET password = $1, reset_token = NULL, reset_token_expiry = NULL
       WHERE reset_token = $2`,
      [password, token]
    );
    res.json({
      success: true,
      message: 'Password reset successfully! You can now login.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET ALL COMPANIES ─────────────────────────────────────
app.get('/api/companies', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, COUNT(u.id) as user_count
       FROM companies c
       LEFT JOIN users u ON u.company_id = c.id
       GROUP BY c.id ORDER BY c.created_at DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET ALL SALES ─────────────────────────────────────────
app.get('/api/sales', async (req, res) => {
  try {
    const { company_id } = req.query;
    let query = 'SELECT * FROM sales';
    let params = [];
    if (company_id) {
      query += ' WHERE company_id = $1';
      params = [company_id];
    }
    query += ' ORDER BY sale_date DESC';
    const result = await pool.query(query, params);
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST NEW SALE ─────────────────────────────────────────
app.post('/api/sales', async (req, res) => {
  try {
    const { sale_date, product, category, region, customer,
            quantity, unit_price, unit_cost, salesperson,
            payment, company_id } = req.body;
    const result = await pool.query(
      `INSERT INTO sales
       (sale_date, product, category, region, customer,
        quantity, unit_price, unit_cost, salesperson, payment, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [sale_date, product, category, region, customer,
       quantity, unit_price, unit_cost, salesperson, payment, company_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── KPI SUMMARY ───────────────────────────────────────────
app.get('/api/kpis', async (req, res) => {
  try {
    const { company_id } = req.query;
    let where = company_id ? 'WHERE company_id = $1' : '';
    let params = company_id ? [company_id] : [];
    const result = await pool.query(`
      SELECT
        SUM(quantity * unit_price) AS total_revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS total_profit,
        COUNT(*) AS total_records,
        SUM(quantity) AS total_units,
        ROUND(AVG(unit_price),2) AS avg_unit_price
      FROM sales ${where}
    `, params);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REVENUE BY REGION ─────────────────────────────────────
app.get('/api/regions', async (req, res) => {
  try {
    const { company_id } = req.query;
    let where = company_id ? 'WHERE company_id = $1' : '';
    let params = company_id ? [company_id] : [];
    const result = await pool.query(`
      SELECT
        region,
        SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit,
        COUNT(*) AS records
      FROM sales ${where}
      GROUP BY region ORDER BY revenue DESC
    `, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REVENUE BY CATEGORY ───────────────────────────────────
app.get('/api/categories', async (req, res) => {
  try {
    const { company_id } = req.query;
    let where = company_id ? 'WHERE company_id = $1' : '';
    let params = company_id ? [company_id] : [];
    const result = await pool.query(`
      SELECT
        category,
        SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit,
        COUNT(*) AS records
      FROM sales ${where}
      GROUP BY category ORDER BY revenue DESC
    `, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── MONTHLY TREND ─────────────────────────────────────────
app.get('/api/monthly', async (req, res) => {
  try {
    const { company_id } = req.query;
    let where = company_id ? 'WHERE company_id = $1' : '';
    let params = company_id ? [company_id] : [];
    const result = await pool.query(`
      SELECT
        TO_CHAR(sale_date, 'YYYY-MM') AS month,
        SUM(quantity * unit_price) AS revenue,
        SUM(quantity * unit_price - quantity * unit_cost) AS profit,
        COUNT(*) AS records
      FROM sales ${where}
      GROUP BY TO_CHAR(sale_date, 'YYYY-MM')
      ORDER BY month ASC
    `, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── INVENTORY ROUTES ──────────────────────────────────────
app.get('/api/inventory/summary', async (req, res) => {
  try {
    const { company_id } = req.query;
    let where = company_id ? 'WHERE company_id = $1' : '';
    let params = company_id ? [company_id] : [];
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_products,
        SUM(quantity_in_stock) as total_units,
        SUM(quantity_in_stock * unit_cost) as total_cost_value,
        SUM(quantity_in_stock * unit_price) as total_retail_value,
        COUNT(CASE WHEN quantity_in_stock = 0 THEN 1 END) as out_of_stock,
        COUNT(CASE WHEN quantity_in_stock > 0
              AND quantity_in_stock <= reorder_level THEN 1 END) as low_stock
      FROM inventory ${where}
    `, params);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/inventory', async (req, res) => {
  try {
    const { company_id } = req.query;
    let query = 'SELECT * FROM inventory';
    let params = [];
    if (company_id) {
      query += ' WHERE company_id = $1';
      params = [company_id];
    }
    query += ' ORDER BY product ASC';
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/inventory', async (req, res) => {
  const { product, category, unit_price, unit_cost,
          quantity_in_stock, reorder_level, supplier, company_id } = req.body;
  try {
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

app.put('/api/inventory/:id', async (req, res) => {
  const { id } = req.params;
  const { quantity_in_stock, unit_price, unit_cost,
          reorder_level, supplier } = req.body;
  try {
    const result = await pool.query(
      `UPDATE inventory SET
       quantity_in_stock=$1, unit_price=$2, unit_cost=$3,
       reorder_level=$4, supplier=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [quantity_in_stock, unit_price, unit_cost,
       reorder_level, supplier, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM inventory WHERE id=$1', [id]);
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── USER MANAGEMENT ROUTES ────────────────────────────────
app.get('/api/users', async (req, res) => {
  try {
    const { company_id } = req.query;
    let query = 'SELECT id, name, email, role, region, active, company_id, created_at FROM users';
    let params = [];
    if (company_id) {
      query += ' WHERE company_id = $1';
      params = [company_id];
    }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  const { name, email, password, role, region, company_id } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, region, company_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, email, role, region, active`,
      [name, email, password, role, region, company_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, role, region, active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET name=$1, role=$2, region=$3, active=$4
       WHERE id=$5 RETURNING id, name, email, role, region, active`,
      [name, role, region, active, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/users/:id/password', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  try {
    await pool.query('UPDATE users SET password=$1 WHERE id=$2',
      [password, id]);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── START SERVER ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log('=====================================');
  console.log(' SABIAS Multi-Company API v2.0');
  console.log(' Running on port ' + PORT);
  console.log(' Currency: Malawian Kwacha (MWK)');
  console.log('=====================================');
});