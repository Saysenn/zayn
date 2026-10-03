const env = require('./env');

const sessionConfig = {
  cookieName: 'crm_session',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.nodeEnv === 'production',
  },
};

module.exports = sessionConfig;
