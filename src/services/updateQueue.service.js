import databaseService from './database.service.js';
import GoogleSheetsService from './googleSheets.service.js';

const sheetsService = new GoogleSheetsService();

/**
 * Update Queue Service
 * Handles race condition prevention with Last-Write-Wins strategy
 * Bidirectional sync: Web ↔ DB ↔ Sheet
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
     * Process all queued updates - Bidirectional sync
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

                // Always update DB first
                await databaseService.upsertOrder(orderData);
                dbUpdated++;

                // Sync to Sheet (if source is web, update Sheet)
                if (_source === 'web') {
                    try {
                        await this.syncToSheet('F3', orderData);
                        sheetUpdated++;
                    } catch (err) {
                        console.error(`❌ Sheet sync failed for ${orderData.ma_don_hang}:`, err.message);
                    }
                }
            }

            const duration = Date.now() - startTime;
            console.log(`✅ Queue processed: ${updates.length} in ${duration}ms (DB: ${dbUpdated}, Sheet: ${sheetUpdated})`);

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
     * Sync a single order back to Google Sheet
     */
    async syncToSheet(sheetName, orderData) {
        const { ma_don_hang, ...fieldsToUpdate } = orderData;

        if (!ma_don_hang) {
            throw new Error('Missing ma_don_hang');
        }

        // Convert DB column names to Sheet column names
        const dbToSheetMapping = {
            'ma_tracking': 'Mã Tracking',
            'ngay_len_don': 'Ngày lên đơn',
            'name': 'Name*',
            'phone': 'Phone*',
            'address': 'Add',
            'city': 'City',
            'state': 'State',
            'trang_thai_giao_hang_nb': 'Trạng thái giao hàng NB',
            'ket_qua_check': 'Kết quả Check',
            'ly_do': 'Lý do',
            'nhan_vien_sale': 'Nhân viên Sale',
            'ghi_chu': 'Ghi chú'
            // Add more mappings as needed
        };

        // Convert to Sheet format
        const sheetUpdate = { primaryKey: ma_don_hang };
        for (const [dbCol, value] of Object.entries(fieldsToUpdate)) {
            const sheetCol = dbToSheetMapping[dbCol];
            if (sheetCol && value !== undefined) {
                sheetUpdate[sheetCol] = value;
            }
        }

        // Use existing updateSingleByPrimaryKey method
        const result = await sheetsService.updateSingleByPrimaryKey(sheetName, sheetUpdate);

        console.log(`📤 Synced to Sheet: ${ma_don_hang}`);
        return result;
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

