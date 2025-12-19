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
        // Loop protection: Map<ma_don_hang, lockExpiryTimestamp>
        this.syncLocks = new Map();
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

        // 🔄 CRITICAL: Convert Vietnamese field names to snake_case for DB
        // This mapping is the REVERSE of dbToSheetMapping in syncToSheet
        const sheetToDbMapping = {
            'Mã đơn hàng': 'ma_don_hang',
            'Kết quả Check': 'ket_qua_check',
            'Trạng thái giao hàng NB': 'trang_thai_giao_hang_nb',
            'Mã Tracking': 'ma_tracking',
            'Lý do': 'ly_do',
            'Trạng thái thu tiền': 'trang_thai_thu_tien',
            'Ghi chú của VĐ': 'ghi_chu_vd',
            'Ngày lên đơn': 'ngay_len_don',
            'Name*': 'name',
            'Phone*': 'phone',
            'Add': 'address',
            'City': 'city',
            'State': 'state',
            'khu vực': 'khu_vuc',
            'Zipcode': 'zipcode',
            'Mặt hàng': 'mat_hang',
            'Tên mặt hàng 1': 'ten_mat_hang_1',
            'Số lượng mặt hàng 1': 'so_luong_mat_hang_1',
            'Tên mặt hàng 2': 'ten_mat_hang_2',
            'Số lượng mặt hàng 2': 'so_luong_mat_hang_2',
            'Quà tặng': 'qua_tang',
            'Số lượng quà kèm': 'so_luong_qua_kem',
            'Giá bán': 'gia_ban',
            'Loại tiền thanh toán': 'loai_tien_thanh_toan',
            'Tổng tiền VNĐ': 'tong_tien_vnd',
            'Hình thức thanh toán': 'hinh_thuc_thanh_toan',
            'Ghi chú': 'ghi_chu',
            'Ngày đóng hàng': 'ngay_dong_hang',
            'Trạng thái giao hàng': 'trang_thai_giao_hang',
            'Thời gian giao dự kiến': 'thoi_gian_giao_du_kien',
            'Phí ship nội địa Mỹ (usd)': 'phi_ship_noi_dia_my',
            'Phí xử lý đơn đóng hàng-Lưu kho(usd)': 'phi_xu_ly_don',
            'GHI CHÚ': 'ghi_chu_chung',
            'Nhân viên Sale': 'nhan_vien_sale',
            'NV Vận đơn': 'nv_van_don',
            'Đơn vị vận chuyển': 'don_vi_van_chuyen',
            'Số tiền của đơn hàng đã về TK Cty': 'so_tien_ve_tk',
            'Kế toán xác nhận thu tiền về': 'ke_toan_xac_nhan',
            'Ngày Kế toán đối soát với FFM lần 2': 'ngay_doi_soat'
        };

        // Convert Vietnamese keys to snake_case
        const convertedUpdates = {};
        for (const [key, value] of Object.entries(updates)) {
            const dbKey = sheetToDbMapping[key] || key; // Use mapping or keep original
            convertedUpdates[dbKey] = value;
        }

        // 🛡️ 1. Loop Protection: Ignore echoes from Sheet if we just synced TO it
        if (source === 'sheet') {
            const lockExpiry = this.syncLocks.get(maDonHang);
            if (lockExpiry && lockExpiry > timestamp) {
                console.log(`🛡️ Loop Protection: Ignored echo from Sheet for ${maDonHang}`);
                return {
                    queued: false,
                    conflict: false,
                    message: 'Ignored echo from Sheet'
                };
            }
        }

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

        // Add to queue with CONVERTED field names (snake_case for DB)
        this.queue.set(maDonHang, {
            ma_don_hang: maDonHang,
            ...convertedUpdates,
            _source: source,
            _timestamp: timestamp,
            _queuedAt: new Date().toISOString()
        });

        console.log(`📥 Queued: ${maDonHang} from ${source} with fields:`, Object.keys(convertedUpdates));

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
                const dbResult = await databaseService.upsertOrder(orderData, { source: _source, timestamp: _timestamp });
                if (dbResult) {
                    dbUpdated++;
                    console.log(`🗄️ DB Sync [${_source}]: ${orderData.ma_don_hang} -> ${orderData.trang_thai_giao_hang_nb || 'updated'}`);
                } else {
                    console.log(`🗄️ DB Skip [${_source}]: ${orderData.ma_don_hang} (newer record already exists)`);
                }

                // Sync to Sheet (if source is web, update Sheet)
                if (_source === 'web' && dbResult) {
                    try {
                        await this.syncToSheet('F3', orderData);
                        sheetUpdated++;

                        // 🔒 Set Loop Protection Lock
                        // Ignore any incoming webhooks for this ID for 10 seconds
                        this.syncLocks.set(orderData.ma_don_hang, Date.now() + 10000);
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
            'ma_don_hang': 'Mã đơn hàng',
            'ket_qua_check': 'Kết quả Check',
            'trang_thai_giao_hang_nb': 'Trạng thái giao hàng NB',
            'ma_tracking': 'Mã Tracking',
            'ly_do': 'Lý do',
            'trang_thai_thu_tien': 'Trạng thái thu tiền',
            'ghi_chu_vd': 'Ghi chú của VĐ',
            'ngay_len_don': 'Ngày lên đơn',
            'name': 'Name*',
            'phone': 'Phone*',
            'address': 'Add',
            'city': 'City',
            'state': 'State',
            'khu_vuc': 'khu vực',
            'zipcode': 'Zipcode',
            'mat_hang': 'Mặt hàng',
            'ten_mat_hang_1': 'Tên mặt hàng 1',
            'so_luong_mat_hang_1': 'Số lượng mặt hàng 1',
            'ten_mat_hang_2': 'Tên mặt hàng 2',
            'so_luong_mat_hang_2': 'Số lượng mặt hàng 2',
            'qua_tang': 'Quà tặng',
            'so_luong_qua_kem': 'Số lượng quà kèm',
            'gia_ban': 'Giá bán',
            'loai_tien_thanh_toan': 'Loại tiền thanh toán',
            'tong_tien_vnd': 'Tổng tiền VNĐ',
            'hinh_thuc_thanh_toan': 'Hình thức thanh toán',
            'ghi_chu': 'Ghi chú',
            'ngay_dong_hang': 'Ngày đóng hàng',
            'trang_thai_giao_hang': 'Trạng thái giao hàng',
            'thoi_gian_giao_du_kien': 'Thời gian giao dự kiến',
            'phi_ship_noi_dia_my': 'Phí ship nội địa Mỹ (usd)',
            'phi_xu_ly_don': 'Phí xử lý đơn đóng hàng-Lưu kho(usd)',
            'ghi_chu_chung': 'GHI CHÚ',
            'nhan_vien_sale': 'Nhân viên Sale',
            'nv_van_don': 'NV Vận đơn',
            'don_vi_van_chuyen': 'Đơn vị vận chuyển',
            'so_tien_ve_tk': 'Số tiền của đơn hàng đã về TK Cty',
            'ke_toan_xac_nhan': 'Kế toán xác nhận thu tiền về',
            'ngay_doi_soat': 'Ngày Kế toán đối soát với FFM lần 2'
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

