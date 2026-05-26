#!/bin/bash
# Azure App Service startup command.
# Installs server dependencies and launches the Express server, which also
# serves the prebuilt React client from client/dist.
cd server && npm ci --omit=dev && node src/server.js
