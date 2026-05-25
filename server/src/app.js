/**
 * Express App
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config/config');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { requireWriteAuth } = require('./middleware/writeAuth');
const logger = require('./utils/logger');

// Import routes
const clubRoutes = require('./routes/club');
const playersRoutes = require('./routes/players');
const seasonsRoutes = require('./routes/seasons');
const roundsRoutes = require('./routes/rounds');
const matchesRoutes = require('./routes/matches');
const gamesRoutes = require('./routes/games');
const matchGamesRoutes = require('./routes/matchGames');
const venuesRoutes = require('./routes/venues');
const titlesRoutes = require('./routes/titles');
const bookingsRoutes = require('./routes/bookings');
const uploadRoutes = require('./routes/upload');

const app = express();

// Middleware
app.use(cors(config.cors));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, _res, next) => {
  // Skip logging for static assets
  if (!req.originalUrl.startsWith('/api')) return next();
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

// Static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Frontend static files (production build)
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// API routes
app.use('/api', requireWriteAuth);
app.use('/api/club', clubRoutes);
app.use('/api/players', playersRoutes);
app.use('/api/seasons', seasonsRoutes);
app.use('/api/rounds', roundsRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/matches/:matchId/games', matchGamesRoutes);
app.use('/api/venues', venuesRoutes);
app.use('/api/titles', titlesRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/upload', uploadRoutes);

// SPA fallback: non-API routes serve index.html
const clientIndex = path.join(__dirname, '..', '..', 'client', 'dist', 'index.html');
app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api')) return next();
  res.sendFile(clientIndex, (err) => {
    if (err) next();
  });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
