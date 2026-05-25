/**
 * JWT configuration
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET || 'bad-club-secret-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '30d'
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development'
  },
  auth: {
    adminToken: process.env.ADMIN_TOKEN || ''
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }
};
