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

// ── TEST ROUTE ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    message: 'SABIAS Multi-Company API is running!',
    version: '2.0.0',
    currency: 'MWK'
  });
});

// ── COMPANY REGISTRATION ──────────────────────────────────
app.post('/api/companies/register', async (req, res) => {
  const { company_name, email, phone, city, address,
          admin_name, password } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const compResult = await client.query(
      `INSERT INTO companies (name, email, phone, city, address)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [company_name, email, phone, city, address]
    );
    const company = compResult.rows[0];
    await client.query(
      `INSERT INTO users (name, email, password, role, region, company_id)
       VALUES ($1,$2,$3,'admin','all',$4)`,
      [admin_name, email, password, company.id]
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'Company registered successfully!',
               company_id: company.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ── GET ALL COMPANIES (Super Admin) ───────────────────────
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

// ── GET ALL SALES (filtered by company) ───────────────────
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
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [password, id]);
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