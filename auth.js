const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'sabias-secret-key-2026';

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check database for user
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND password = $2',
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = result.rows[0];

    if (!user.active) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated. Contact your admin.'
      });
    }

    // Get company info
    let company = null;
    if (user.company_id) {
      const compResult = await pool.query(
        'SELECT * FROM companies WHERE id = $1',
        [user.company_id]
      );
      company = compResult.rows[0] || null;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role,
        company_id: user.company_id },
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
        company: company?.name || 'SABIAS',
      }
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;