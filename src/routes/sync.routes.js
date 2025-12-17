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
 * Sync single row from webhook via queue
 */
router.post('/webhook', syncController.webhookSync);

/**
 * POST /sync/update
 * Queue update from web frontend
 * Body: { maDonHang: "DH001", field1: value1, ... }
 */
router.post('/update', syncController.queueUpdate);

/**
 * GET /sync/status
 * Get sync, database, and queue status
 */
router.get('/status', syncController.getStatus);

/**
 * GET /sync/db-data
 * Get paginated data from database
 * Query: page, limit, sortBy, order, status
 */
router.get('/db-data', syncController.getDbData);

/**
 * POST /sync/init-schema
 * Initialize database schema (create tables)
 */
router.post('/init-schema', syncController.initSchema);

/**
 * POST /sync/flush-queue
 * Force process all queued updates immediately
 */
router.post('/flush-queue', syncController.flushQueue);

/**
 * POST /sync/generate-mock
 * Generate mock data for testing
 * Body: { count: 5000, startIndex: 11 }
 */
router.post('/generate-mock', syncController.generateMockData);

/**
 * POST /sync/db-to-sheet
 * Bulk sync all DB data to Google Sheet (background)
 * Body: { batchSize: 100, startFrom: 0 }
 * WARNING: Takes ~15 mins for 5000 rows
 */
router.post('/db-to-sheet', syncController.syncDbToSheet);

export default router;

