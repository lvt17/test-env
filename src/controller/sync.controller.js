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

            // Invalidate server-side cache on update
            SyncController.pageCache.clear();

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

            // Invalidate server-side cache on update
            SyncController.pageCache.clear();

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
     * 
     * PERFORMANCE: Uses server-side + edge caching
     */

    // Server-side cache for fast responses
    static pageCache = new Map();
    static CACHE_TTL = 30000; // 30 seconds

    async getDbData(req, res) {
        try {
            const { page = 1, limit = 40, sortBy = 'id', order = 'asc', status } = req.query;
            const cacheKey = `${page}_${limit}_${sortBy}_${order}_${status || 'all'}`;
            const now = Date.now();

            // Check server-side cache first
            const cached = SyncController.pageCache.get(cacheKey);
            if (cached && (now - cached.timestamp) < SyncController.CACHE_TTL) {
                // Add cache hit header for debugging
                res.set('X-Cache', 'HIT');
                res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
                return res.json(cached.data);
            }

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

            const responseData = {
                success: true,
                data,
                meta: {
                    ...result.meta,
                    source: 'database',
                    timestamp: new Date().toISOString()
                }
            };

            // Save to server cache
            SyncController.pageCache.set(cacheKey, {
                data: responseData,
                timestamp: now
            });

            // Edge caching headers for Vercel CDN
            res.set('X-Cache', 'MISS');
            res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');

            res.json(responseData);
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

            // Invalidate server-side cache on flush
            SyncController.pageCache.clear();

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

            // Limit to prevent abuse (increased for 50k scale testing)
            const maxCount = 50000;
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

    /**
     * POST /sync/db-to-sheet
     * Bulk sync all DB data to Google Sheet (background job)
     * WARNING: This can take 10-15 minutes for 5000+ rows
     */
    async syncDbToSheet(req, res) {
        try {
            const { batchSize = 100, startFrom = 0 } = req.body;
            const GoogleSheetsService = (await import('../services/googleSheets.service.js')).default;
            const sheetsService = new GoogleSheetsService();

            console.log(`🔄 Starting DB → Sheet sync (batch: ${batchSize}, start: ${startFrom})...`);

            await databaseService.connect();

            // Get total count
            const totalCount = await databaseService.getOrdersCount();
            console.log(`📊 Total rows in DB: ${totalCount}`);

            // Send immediate response
            res.json({
                success: true,
                message: 'Sync started in background',
                totalRows: totalCount,
                estimatedTime: `~${Math.ceil(totalCount / batchSize * 2)} minutes`
            });

            // Continue sync in background
            this.performBulkSheetSync(sheetsService, totalCount, batchSize, startFrom);

        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * Background sync processor
     */
    async performBulkSheetSync(sheetsService, totalCount, batchSize, startFrom) {
        const syncService = (await import('../services/sync.service.js')).default;
        let synced = 0;
        let page = Math.floor(startFrom / batchSize) + 1;

        try {
            while (synced + startFrom < totalCount) {
                // Fetch batch from DB
                const result = await databaseService.getAllOrdersPaginated({
                    page,
                    limit: batchSize,
                    sortBy: 'id',
                    order: 'asc'
                });

                if (!result.data || result.data.length === 0) break;

                // Convert to Sheet format
                const sheetRows = result.data.map(row => syncService.dbRowToSheetRow(row));

                // Write batch to Sheet
                try {
                    await sheetsService.addMultipleRows('F3', sheetRows);
                    synced += sheetRows.length;
                    console.log(`📤 Synced batch ${page}: ${synced}/${totalCount} rows`);
                } catch (err) {
                    console.error(`❌ Batch ${page} failed:`, err.message);
                }

                page++;

                // Rate limit: wait 1s between batches to avoid API limits
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log(`✅ DB → Sheet sync complete: ${synced} rows`);

        } catch (error) {
            console.error('❌ Background sync failed:', error.message);
        }
    }

    /**
     * POST /sync/update-prices
     * Update prices for existing mock data (fixes 0 values)
     */
    async updatePrices(req, res) {
        try {
            await databaseService.connect();

            if (!databaseService.isAvailable()) {
                return res.status(503).json({
                    success: false,
                    message: 'Database not available'
                });
            }

            console.log('📊 Updating prices for all orders with 0 values...');
            const startTime = Date.now();

            // Update all rows with random prices between 50,000 and 500,000 VND
            const query = `
                UPDATE orders 
                SET 
                    gia_ban = FLOOR(RANDOM() * 450000 + 50000),
                    tong_tien_vnd = FLOOR(RANDOM() * 450000 + 50000)
                WHERE gia_ban = 0 OR gia_ban IS NULL OR tong_tien_vnd = 0 OR tong_tien_vnd IS NULL;
            `;

            const result = await databaseService.query(query);
            const duration = Date.now() - startTime;

            // Verify
            const stats = await databaseService.query(`
                SELECT 
                    COUNT(*) as total,
                    AVG(gia_ban) as avg_price,
                    MIN(gia_ban) as min_price,
                    MAX(gia_ban) as max_price
                FROM orders
            `);

            res.json({
                success: true,
                message: `Updated ${result.rowCount} orders with random prices`,
                updated: result.rowCount,
                duration: `${duration}ms`,
                stats: {
                    total: parseInt(stats.rows[0].total),
                    avgPrice: Math.round(parseFloat(stats.rows[0].avg_price)),
                    minPrice: Math.round(parseFloat(stats.rows[0].min_price)),
                    maxPrice: Math.round(parseFloat(stats.rows[0].max_price))
                }
            });

        } catch (error) {
            console.error('❌ Update prices failed:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
}

export default new SyncController();



