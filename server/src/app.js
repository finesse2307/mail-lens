'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');

const apiRoutes = require('./routes/api');
const { sessionMiddleware } = require('./middleware/session');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '200kb' }));
  // Session middleware: attaches req.sessionId to every request and sets a
  // signed cookie on first contact. Must run before any route that reads it.
  app.use(sessionMiddleware);

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api', apiRoutes);

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