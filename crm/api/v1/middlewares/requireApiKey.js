const { isValidApiKey } = require('../shared/apiKey.helper');

function requireApiKey(req, res, next) {
  if (!isValidApiKey(req.get('x-api-key'))) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

module.exports = { requireApiKey };
