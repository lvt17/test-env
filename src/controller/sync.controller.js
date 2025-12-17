import syncService from '../services/sync.service.js';
import databaseService from '../services/database.service.js';
import updateQueueService from '../services/updateQueue.service.js';
import { generateMockOrders } from '../services/mockData.service.js';

/**
 * Sync Controller - Handles Sheet ↔ DB synchronization endpoints
 */
class SyncController {

    /**
     * POST /sync/initial
     * Initial sync: Fetch all data from Sheet and insert into DB
     */
    async initialSync(req, res) {
        try {
            const { sheetName = 'F3' } = req.body;

            const result = await syncService.syncFromSheet(sheetName);

            if (result.success) {
                res.json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * POST /sync/webhook
     * Sync single row from webhook via queue
     */
    async webhookSync(req, res) {
        try {
            const { primaryKey, changedFields } = req.body;

            if (!primaryKey) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing primaryKey'
                });
            }

            // Use queue to prevent race conditions
            const result = updateQueueService.enqueue(primaryKey, changedFields, 'sheet');

            res.json({
                success: true,
                ...result,
                message: result.queued ? 'Update queued' : 'Update rejected due to conflict'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * POST /sync/update
     * Queue update from web frontend
     */
    async queueUpdate(req, res) {
        try {
            const { maDonHang, ...updates } = req.body;

            if (!maDonHang) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing maDonHang'
                });
            }

            // Use queue to prevent race conditions
            const result = updateQueueService.enqueue(maDonHang, updates, 'web');

            res.json({
                success: result.queued,
                ...result
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * GET /sync/status
     * Get sync, database, and queue status
     */
    async getStatus(req, res) {
        try {
            const syncStatus = syncService.getStatus();
            const queueStatus = updateQueueService.getStatus();

            let dbCount = 0;
            try {
                if (databaseService.isAvailable()) {
                    dbCount = await databaseService.getOrdersCount();
                }
            } catch (err) {
                console.error('Count error:', err.message);
            }

            res.json({
                success: true,
                sync: syncStatus,
                queue: queueStatus,
                dbOrdersCount: dbCount,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * GET /sync/db-data
     * Get paginated data from database
     * Query params: page, limit, sortBy, order, status
     */
    async getDbData(req, res) {
        try {
            const { page = 1, limit = 40, sortBy = 'id', order = 'asc', status } = req.query;

            await databaseService.connect();

            if (!databaseService.isAvailable()) {
                return res.status(503).json({
                    success: false,
                    message: 'Database not available'
                });
            }

            const result = await databaseService.getAllOrdersPaginated({
                page: parseInt(page),
                limit: parseInt(limit),
                sortBy,
                order,
                status: status || null
            });

            // Convert to Sheet format for frontend compatibility
            const data = result.data.map(order => syncService.dbRowToSheetRow(order));

            res.json({
                success: true,
                data,
                meta: {
                    ...result.meta,
                    source: 'database',
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * POST /sync/init-schema
     * Initialize database schema (create tables)
     */
    async initSchema(req, res) {
        try {
            await databaseService.connect();
            await databaseService.initializeSchema();

            res.json({
                success: true,
                message: 'Database schema initialized'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * POST /sync/flush-queue
     * Force process all queued updates immediately
     */
    async flushQueue(req, res) {
        try {
            await updateQueueService.flush();

            res.json({
                success: true,
                message: 'Queue flushed',
                status: updateQueueService.getStatus()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * POST /sync/generate-mock
     * Generate mock data for testing
     * Body: { count: 5000, startIndex: 11 }
     */
    async generateMockData(req, res) {
        try {
            const { count = 100, startIndex = 11 } = req.body;

            // Limit to prevent abuse
            const maxCount = 10000;
            const actualCount = Math.min(count, maxCount);

            console.log(`🎲 Generating ${actualCount} mock orders starting from ${startIndex}...`);

            await databaseService.connect();
            await databaseService.initializeSchema();

            // Generate mock data
            const mockOrders = generateMockOrders(actualCount, startIndex);

            // Bulk insert in batches
            const batchSize = 500;
            let insertedCount = 0;
            const startTime = Date.now();

            for (let i = 0; i < mockOrders.length; i += batchSize) {
                const batch = mockOrders.slice(i, i + batchSize);
                try {
                    const result = await databaseService.bulkUpsertOrders(batch);
                    insertedCount += result.inserted || batch.length;
                    console.log(`📦 Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} rows`);
                } catch (err) {
                    console.error(`Batch failed:`, err.message);
                }
            }

            const duration = Date.now() - startTime;

            res.json({
                success: true,
                message: `Generated ${insertedCount} mock orders`,
                count: insertedCount,
                duration: `${duration}ms`,
                rowsPerSecond: Math.round(insertedCount / (duration / 1000))
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
}

export default new SyncController();


