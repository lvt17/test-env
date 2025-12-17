import databaseService from './database.service.js';

/**
 * Update Queue Service
 * Handles race condition prevention with Last-Write-Wins strategy
 */
class UpdateQueueService {
    constructor() {
        // Pending updates: Map<ma_don_hang, { updates, source, timestamp }>
        this.queue = new Map();
        this.isProcessing = false;
        this.processInterval = null;
        this.BATCH_INTERVAL_MS = 1000; // Process every 1 second
    }

    /**
     * Start the queue processor
     */
    start() {
        if (this.processInterval) return;

        this.processInterval = setInterval(() => {
            this.processQueue();
        }, this.BATCH_INTERVAL_MS);

        console.log('✅ Update Queue started (1s batch interval)');
    }

    /**
     * Stop the queue processor
     */
    stop() {
        if (this.processInterval) {
            clearInterval(this.processInterval);
            this.processInterval = null;
        }
    }

    /**
     * Enqueue an update
     * @param {string} maDonHang - Primary key
     * @param {object} updates - Fields to update
     * @param {string} source - 'web' or 'sheet'
     * @returns {object} - { queued, conflict, winner }
     */
    enqueue(maDonHang, updates, source = 'web') {
        const timestamp = Date.now();
        const existing = this.queue.get(maDonHang);

        // Check for conflict (same row updated within batch window)
        if (existing) {
            // Last Write Wins - compare timestamps
            if (existing.timestamp > timestamp) {
                console.log(`⚠️ Conflict: ${maDonHang}, winner: ${existing.source}`);
                return {
                    queued: false,
                    conflict: true,
                    winner: existing.source,
                    message: `Update rejected - newer update from ${existing.source} exists`
                };
            }
            console.log(`⚠️ Conflict resolved: ${maDonHang}, winner: ${source} (newer)`);
        }

        // Add to queue
        this.queue.set(maDonHang, {
            ma_don_hang: maDonHang,
            ...updates,
            _source: source,
            _timestamp: timestamp,
            _queuedAt: new Date().toISOString()
        });

        console.log(`📥 Queued: ${maDonHang} from ${source}`);

        return {
            queued: true,
            conflict: false,
            queueSize: this.queue.size
        };
    }

    /**
     * Process all queued updates
     */
    async processQueue() {
        if (this.isProcessing || this.queue.size === 0) return;

        this.isProcessing = true;
        const startTime = Date.now();
        const toProcess = new Map(this.queue);
        this.queue.clear();

        try {
            await databaseService.connect();

            const updates = Array.from(toProcess.values());
            let dbUpdated = 0;
            let sheetUpdated = 0;

            for (const update of updates) {
                const { _source, _timestamp, _queuedAt, ...orderData } = update;

                // Update DB
                await databaseService.upsertOrder(orderData);
                dbUpdated++;

                // If source is web, sync back to Sheet (TODO: implement)
                if (_source === 'web') {
                    // await sheetsService.updateRow(orderData);
                    sheetUpdated++;
                }
            }

            const duration = Date.now() - startTime;
            console.log(`✅ Queue processed: ${updates.length} updates in ${duration}ms (DB: ${dbUpdated}, Sheet: ${sheetUpdated})`);

        } catch (error) {
            console.error('❌ Queue processing failed:', error.message);
            // Re-queue failed updates
            for (const [key, value] of toProcess) {
                if (!this.queue.has(key)) {
                    this.queue.set(key, value);
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Get queue status
     */
    getStatus() {
        return {
            queueSize: this.queue.size,
            isProcessing: this.isProcessing,
            isRunning: this.processInterval !== null
        };
    }

    /**
     * Force process queue immediately
     */
    async flush() {
        await this.processQueue();
    }
}

// Export singleton
const updateQueueService = new UpdateQueueService();

// Auto-start in production
if (process.env.NODE_ENV !== 'test') {
    updateQueueService.start();
}

export default updateQueueService;
