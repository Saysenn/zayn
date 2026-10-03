const env = require('./env');

const jwtConfig = {
  secret: env.jwtSecret,
  expiresIn: '12h',
};

module.exports = jwtConfig;
