const cookieParser = require('cookie-parser');
const env = require('./env');

const cookieParserMiddleware = cookieParser(env.cookieSecret);

module.exports = cookieParserMiddleware;
