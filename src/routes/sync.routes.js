import express from 'express';
import syncController from '../controller/sync.controller.js';

const router = express.Router();

/**
 * POST /sync/initial
 * Initial sync: Fetch all data from Sheet and insert into PostgreSQL
 * Body: { sheetName: "F3" }
 */
router.post('/initial', syncController.initialSync);

/**
 * POST /sync/webhook
 * Sync single row from webhook (called by Google Apps Script)
 */
router.post('/webhook', syncController.webhookSync);

/**
 * GET /sync/status
 * Get sync and database status
 */
router.get('/status', syncController.getStatus);

/**
 * GET /sync/db-data
 * Get data directly from database
 * Query: limit, offset
 */
router.get('/db-data', syncController.getDbData);

/**
 * POST /sync/init-schema
 * Initialize database schema (create tables)
 */
router.post('/init-schema', syncController.initSchema);

export default router;
