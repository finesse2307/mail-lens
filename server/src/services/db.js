'use strict';

/**
 * Data layer for the `analyses` collection.
 *
 * Uses MongoDB when MONGODB_URI is set. If it is not set (or the connection
 * fails), it falls back to an in-memory store so the app still runs for
 * local development and demos — the same graceful-degradation principle the
 * rest of the app follows.
 */

const { MongoClient, ObjectId } = require('mongodb');

const DB_NAME = process.env.MONGODB_DB || 'phishing_analyzer';
const COLLECTION = 'analyses';

let collection = null; // MongoDB collection handle, when connected
let memoryStore = null; // in-memory array, when no DB
let memorySeq = 1;

/** Connect to MongoDB, or activate the in-memory fallback. */
async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    memoryStore = [];
    console.warn('[db] MONGODB_URI not set — using in-memory store (non-persistent).');
    return;
  }
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    collection = client.db(DB_NAME).collection(COLLECTION);
    await collection.createIndex({ createdAt: -1 });
    console.log('[db] Connected to MongoDB.');
  } catch (err) {
    memoryStore = [];
    console.warn('[db] MongoDB connection failed — using in-memory store. ' + err.message);
  }
}

/**
 * Ensure a store exists. If a query runs before connect() (e.g. in route
 * tests that import the app directly), default to the in-memory store rather
 * than throwing — the same graceful-degradation principle the app follows.
 */
function ensureStore() {
  if (!collection && memoryStore === null) {
    memoryStore = [];
  }
}

/** Persist one analysis. Returns the saved document including its id. */
async function saveAnalysis(analysis) {
  ensureStore();
  if (collection) {
    const result = await collection.insertOne(analysis);
    return { _id: result.insertedId.toString(), ...analysis };
  }
  const doc = { _id: 'mem-' + memorySeq++, ...analysis };
  memoryStore.unshift(doc);
  return doc;
}

/** Return recent analyses, newest first, with only the fields the list needs. */
async function listAnalyses(limit = 25) {
  ensureStore();
  if (collection) {
    const docs = await collection
      .find({}, {
        projection: {
          createdAt: 1, emailSubject: 1, senderDisplayName: 1,
          senderDomain: 1, overallRiskScore: 1, overallRiskCategory: 1,
          aiAvailable: 1,
        },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => ({ ...d, _id: d._id.toString() }));
  }
  return memoryStore.slice(0, limit).map((d) => ({
    _id: d._id,
    createdAt: d.createdAt,
    emailSubject: d.emailSubject,
    senderDisplayName: d.senderDisplayName,
    senderDomain: d.senderDomain,
    overallRiskScore: d.overallRiskScore,
    overallRiskCategory: d.overallRiskCategory,
    aiAvailable: d.aiAvailable,
  }));
}

/** Fetch one full analysis by id, or null if not found / id malformed. */
async function getAnalysisById(id) {
  ensureStore();
  if (collection) {
    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return null;
    }
    const doc = await collection.findOne({ _id: objectId });
    return doc ? { ...doc, _id: doc._id.toString() } : null;
  }
  return memoryStore.find((d) => d._id === id) || null;
}

module.exports = { connect, saveAnalysis, listAnalyses, getAnalysisById };
