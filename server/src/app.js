'use strict';

/**
 * Express app factory.
 *
 * Builds and returns the configured Express app WITHOUT starting a listener
 * or connecting to the database. Keeping construction free of side effects
 * makes the app importable directly in tests (supertest-style).
 *
 * server.js is the thin entry point that wires in the DB and calls listen().
 */

const path = require('path');
const express = require('express');
const cors = require('cors');

const apiRoutes = require('./routes/api');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '200kb' }));

  // Health check — handy for Azure App Service monitoring.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api', apiRoutes);

  // In production, serve the built React app from client/dist.
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: 'Not found.' });
    });
  });

  return app;
}

module.exports = { createApp };
