const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'sabias-secret-key-2026';

const protect = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized. Please login.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Reject old tokens issued before security update
    // Old tokens have no company_id so they would return ALL companies data
    if (!decoded.company_id) {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please logout and login again.'
      });
    }

    req.user = decoded;
    next();

  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Token invalid or expired. Please login again.'
    });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required. Contact your administrator.'
    });
  }
  next();
};

const noViewer = (req, res, next) => {
  if (req.user.role === 'viewer') {
    return res.status(403).json({
      success: false,
      message: 'Viewers cannot make changes. Contact your administrator.'
    });
  }
  next();
};

module.exports = { protect, adminOnly, noViewer };