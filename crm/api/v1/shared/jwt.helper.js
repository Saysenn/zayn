const jwt = require('jsonwebtoken');
const jwtConfig = require('../../configs/jwt');

function sign(payload) {
  return jwt.sign(payload, jwtConfig.secret, { expiresIn: jwtConfig.expiresIn });
}

function verify(token) {
  return jwt.verify(token, jwtConfig.secret);
}

module.exports = { sign, verify };
