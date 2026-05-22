const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const crypto = require('crypto');
const { Resend } = require('resend');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'sabias-secret-key-2026';
const resend = new Resend(process.env.RESEND_API_KEY || 're_3rnFvwpk_5mFTNHqCRKjexghimbN1REfb');

// ─── LOGIN ───────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT u.*, c.name as company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE LOWER(u.email) = LOWER($1)
       AND u.password = $2
       AND u.active = true`,
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password or account deactivated.'
      });
    }

    const user = result.rows[0];

    // JWT contains everything — frontend never sends company_id
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

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    // Case-insensitive email check
    const result = await pool.query(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND active = true`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email address.'
      });
    }

    const user = result.rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save token to database
    await pool.query(
      `UPDATE users
       SET reset_token = $1, reset_token_expiry = $2
       WHERE id = $3`,
      [resetToken, resetExpiry, user.id]
    );

    // Build reset link
    const resetLink = `https://www.sabiasanalytics.com/reset-password?token=${resetToken}`;

    // Send email via Resend
    await resend.emails.send({
      from: 'SABIAS <onboarding@resend.dev>',
      to: user.email,
      subject: 'SABIAS — Reset Your Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
          <div style="background: #3E1F00; padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: #FFB800; margin: 0; font-size: 24px;">SABIAS</h1>
            <p style="color: #FF6B35; margin: 4px 0 0; font-size: 12px;">
              Sales & Business Intelligence Analytics System
            </p>
          </div>
          <div style="background: #FFF8F0; padding: 32px; border-radius: 0 0 12px 12px;">
            <h2 style="color: #3E1F00;">Password Reset Request</h2>
            <p style="color: #555;">Hello <strong>${user.name}</strong>,</p>
            <p style="color: #555;">
              We received a request to reset your SABIAS password.
              Click the button below to reset it. This link expires in 1 hour.
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetLink}"
                 style="background: #FF6B35; color: white; padding: 14px 32px;
                        border-radius: 8px; text-decoration: none;
                        font-weight: bold; font-size: 16px;">
                Reset My Password
              </a>
            </div>
            <p style="color: #888; font-size: 12px;">
              If you did not request this, ignore this email.
              Your password will not change.
            </p>
            <p style="color: #888; font-size: 12px;">
              Or copy this link:<br/>
              <a href="${resetLink}" style="color: #FF6B35;">${resetLink}</a>
            </p>
            <hr style="border: none; border-top: 1px solid #FFE8D0; margin: 24px 0;"/>
            <p style="color: #AAA; font-size: 11px; text-align: center;">
              SABIAS — Built by Kings Mwandira · Malawi
            </p>
          </div>
        </div>
      `
    });

    res.json({
      success: true,
      message: 'Password reset link sent to your email address.'
    });

  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  try {
    // Find user with valid non-expired token
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
        message: 'Reset link is invalid or has expired. Please request a new one.'
      });
    }

    const user = result.rows[0];

    // Update password and clear reset token
    await pool.query(
      `UPDATE users
       SET password = $1,
           reset_token = NULL,
           reset_token_expiry = NULL
       WHERE id = $2`,
      [password, user.id]
    );

    res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });

  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;