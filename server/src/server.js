'use strict';

/**
 * Server entry point.
 *
 * Connects the data layer, builds the Express app, and starts listening.
 * All app construction lives in app.js so the app can be imported in tests
 * without booting a server.
 */

require('dotenv').config();

const { createApp } = require('./app');
const { connect } = require('./services/db');

const PORT = process.env.PORT || 4000;

async function start() {
  await connect();
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
}

start();
