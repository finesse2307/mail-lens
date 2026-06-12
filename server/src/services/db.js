'use strict';

const { MongoClient, ObjectId } = require('mongodb');

const DB_NAME = process.env.MONGODB_DB || 'phishing_analyzer';
const COLLECTION = 'analyses';

let collection = null;
let memoryStore = null;
let memorySeq = 1;

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
    // Compound index: scoped history queries hit (sessionId, createdAt desc).
    await collection.createIndex({ sessionId: 1, createdAt: -1 });
    console.log('[db] Connected to MongoDB.');
  } catch (err) {
    memoryStore = [];
    console.warn('[db] MongoDB connection failed — using in-memory store. ' + err.message);
  }
}

function ensureStore() {
  if (!collection && memoryStore === null) {
    memoryStore = [];
  }
}

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

/**
 * Return recent analyses for one session, newest first.
 *
 * sessionId is REQUIRED. If a caller ever omits it, we return an empty list
 * rather than leaking everyone's data. Legacy documents created before the
 * session-scoping fix have no sessionId field and never match — they are
 * orphaned by design.
 */
async function listAnalyses(sessionId, limit = 25) {
  ensureStore();
  if (!sessionId) return [];
  if (collection) {
    const docs = await collection
      .find({ sessionId }, {
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
  return memoryStore
    .filter((d) => d.sessionId === sessionId)
    .slice(0, limit)
    .map((d) => ({
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

/**
 * Fetch one full analysis by id, or null if not found, id malformed, or
 * the analysis belongs to a different session.
 *
 * Returning null in the "wrong session" case is intentional: it makes the
 * API indistinguishable between "this id never existed" and "this id
 * exists but is not yours," which prevents enumeration of other sessions'
 * analysis IDs.
 */
async function getAnalysisById(id, sessionId) {
  ensureStore();
  if (!sessionId) return null;
  if (collection) {
    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return null;
    }
    const doc = await collection.findOne({ _id: objectId, sessionId });
    return doc ? { ...doc, _id: doc._id.toString() } : null;
  }
  const doc = memoryStore.find((d) => d._id === id && d.sessionId === sessionId);
  return doc || null;
}

module.exports = { connect, saveAnalysis, listAnalyses, getAnalysisById };