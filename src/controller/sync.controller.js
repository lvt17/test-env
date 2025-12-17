import syncService from '../services/sync.service.js';
import databaseService from '../services/database.service.js';

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
     * Sync single row from webhook (called by Google Apps Script)
     */
    async webhookSync(req, res) {
        try {
            const webhookData = req.body;

            // Sync to database
            const result = await syncService.syncSingleRow(webhookData);

            res.json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * GET /sync/status
     * Get sync and database status
     */
    async getStatus(req, res) {
        try {
            const status = syncService.getStatus();

            // Try to get DB count
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
                ...status,
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
     * Get data directly from database (bypasses Google Sheets)
     */
    async getDbData(req, res) {
        try {
            const { limit = 100, offset = 0 } = req.query;

            await databaseService.connect();

            if (!databaseService.isAvailable()) {
                return res.status(503).json({
                    success: false,
                    message: 'Database not available'
                });
            }

            const orders = await databaseService.getAllOrders({
                limit: parseInt(limit),
                offset: parseInt(offset)
            });

            // Convert to Sheet format for frontend compatibility
            const data = orders.map(order => syncService.dbRowToSheetRow(order));

            res.json({
                success: true,
                data,
                meta: {
                    total: data.length,
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
}

export default new SyncController();
