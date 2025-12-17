import databaseService from './database.service.js';
import GoogleSheetsService from './googleSheets.service.js';

const googleSheetsService = new GoogleSheetsService();

/**
 * Sync Service - Handles synchronization between Google Sheets and PostgreSQL
 */
class SyncService {
    constructor() {
        this.lastSyncTime = null;
        this.isSyncing = false;
    }

    /**
     * Convert Sheet column names to database column names
     * Handles Vietnamese characters and special characters
     */
    columnToDbName(sheetColumn) {
        const mapping = {
            'Mã đơn hàng': 'ma_don_hang',
            'Mã Tracking': 'ma_tracking',
            'Ngày lên đơn': 'ngay_len_don',
            'Name*': 'name',
            'Phone*': 'phone',
            'Add': 'address',
            'City': 'city',
            'State': 'state',
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
            'Nhân viên Sale': 'nhan_vien_sale',
            'Nhân viên Marketing': 'nhan_vien_marketing',
            'NV Vận đơn': 'nv_van_don',
            'Kết quả Check': 'ket_qua_check',
            'Trạng thái giao hàng NB': 'trang_thai_giao_hang_nb',
            'Lý do': 'ly_do',
            'Đơn vị vận chuyển': 'don_vi_van_chuyen',
            'Trạng thái thu tiền': 'trang_thai_thu_tien',
            'Ngày hẹn đẩy đơn': 'ngay_hen_day_don',
            'Số tiền thực thu': 'so_tien_thuc_thu',
            'Ảnh bill': 'anh_bill',
            'Khu vực': 'khu_vuc',
            'Team': 'team'
        };

        return mapping[sheetColumn] || null;
    }

    /**
     * Convert database column names back to Sheet column names
     */
    dbNameToColumn(dbColumn) {
        const reverseMapping = {
            'ma_don_hang': 'Mã đơn hàng',
            'ma_tracking': 'Mã Tracking',
            'ngay_len_don': 'Ngày lên đơn',
            'name': 'Name*',
            'phone': 'Phone*',
            'address': 'Add',
            'city': 'City',
            'state': 'State',
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
            'nhan_vien_sale': 'Nhân viên Sale',
            'nhan_vien_marketing': 'Nhân viên Marketing',
            'nv_van_don': 'NV Vận đơn',
            'ket_qua_check': 'Kết quả Check',
            'trang_thai_giao_hang_nb': 'Trạng thái giao hàng NB',
            'ly_do': 'Lý do',
            'don_vi_van_chuyen': 'Đơn vị vận chuyển',
            'trang_thai_thu_tien': 'Trạng thái thu tiền',
            'ngay_hen_day_don': 'Ngày hẹn đẩy đơn',
            'so_tien_thuc_thu': 'Số tiền thực thu',
            'anh_bill': 'Ảnh bill',
            'khu_vuc': 'Khu vực',
            'team': 'Team'
        };

        return reverseMapping[dbColumn] || dbColumn;
    }

    /**
     * Convert Sheet row data to DB format
     */
    sheetRowToDbRow(sheetRow) {
        const dbRow = {};

        for (const [sheetCol, value] of Object.entries(sheetRow)) {
            const dbCol = this.columnToDbName(sheetCol);
            if (dbCol && value !== undefined && value !== null && value !== '') {
                // Handle date conversion
                if (dbCol.includes('ngay') && value) {
                    // Try to parse date
                    const dateValue = new Date(value);
                    if (!isNaN(dateValue.getTime())) {
                        dbRow[dbCol] = dateValue.toISOString().split('T')[0];
                    }
                } else {
                    dbRow[dbCol] = value;
                }
            }
        }

        return dbRow;
    }

    /**
     * Convert DB row to Sheet format (for API responses)
     */
    dbRowToSheetRow(dbRow) {
        const sheetRow = { rowIndex: dbRow.id };

        for (const [dbCol, value] of Object.entries(dbRow)) {
            if (dbCol === 'id' || dbCol === 'created_at' || dbCol === 'updated_at') {
                continue;
            }
            const sheetCol = this.dbNameToColumn(dbCol);
            sheetRow[sheetCol] = value;
        }

        return sheetRow;
    }

    /**
     * Initial sync: Fetch all data from Sheet and insert into DB using BULK INSERT
     */
    async syncFromSheet(sheetName = 'F3') {
        if (this.isSyncing) {
            return { success: false, message: 'Sync already in progress' };
        }

        this.isSyncing = true;
        const startTime = Date.now();

        try {
            console.log(`🔄 Starting initial sync from Sheet: ${sheetName}`);

            // Ensure DB is connected and schema exists
            await databaseService.connect();
            await databaseService.initializeSchema();

            // Fetch all data from Google Sheets
            const result = await googleSheetsService.getAllData(sheetName);
            const sheetData = result.data || [];

            if (sheetData.length === 0) {
                this.isSyncing = false;
                return { success: true, message: 'No data to sync', count: 0 };
            }

            // Convert to DB format
            const dbRows = [];
            for (const sheetRow of sheetData) {
                const dbRow = this.sheetRowToDbRow(sheetRow);
                if (dbRow.ma_don_hang) { // Must have primary key
                    dbRows.push(dbRow);
                }
            }

            // BULK INSERT in batches of 500 (100x faster than row-by-row)
            let insertedCount = 0;
            const batchSize = 500;
            const totalBatches = Math.ceil(dbRows.length / batchSize);

            for (let i = 0; i < dbRows.length; i += batchSize) {
                const batch = dbRows.slice(i, i + batchSize);
                const batchNum = Math.floor(i / batchSize) + 1;

                try {
                    const result = await databaseService.bulkUpsertOrders(batch);
                    insertedCount += result.inserted || batch.length;
                    console.log(`📦 Batch ${batchNum}/${totalBatches}: ${batch.length} rows`);
                } catch (err) {
                    console.error(`❌ Batch ${batchNum} failed:`, err.message);
                    // Fallback to individual inserts for this batch
                    for (const row of batch) {
                        try {
                            await databaseService.upsertOrder(row);
                            insertedCount++;
                        } catch (e) {
                            console.error(`Failed: ${row.ma_don_hang}`);
                        }
                    }
                }
            }

            const duration = Date.now() - startTime;
            this.lastSyncTime = new Date();

            console.log(`✅ Initial sync completed: ${insertedCount}/${sheetData.length} rows in ${duration}ms`);

            return {
                success: true,
                message: 'Initial sync completed',
                count: insertedCount,
                total: sheetData.length,
                duration: `${duration}ms`,
                rowsPerSecond: Math.round(insertedCount / (duration / 1000))
            };

        } catch (error) {
            console.error('❌ Initial sync failed:', error);
            return {
                success: false,
                message: error.message
            };
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Sync single row from webhook
     */
    async syncSingleRow(webhookData) {
        try {
            const { primaryKey, changedFields, sheetName } = webhookData;

            if (!primaryKey) {
                return { success: false, message: 'Missing primaryKey' };
            }

            await databaseService.connect();

            // Convert changed fields to DB format
            const updates = { ma_don_hang: primaryKey };

            if (changedFields) {
                for (const [sheetCol, value] of Object.entries(changedFields)) {
                    const dbCol = this.columnToDbName(sheetCol);
                    if (dbCol) {
                        updates[dbCol] = value;
                    }
                }
            }

            // Upsert the row
            const result = await databaseService.upsertOrder(updates);

            console.log(`✅ Synced single row: ${primaryKey}`);

            return {
                success: true,
                message: 'Row synced',
                data: result
            };

        } catch (error) {
            console.error('❌ Single row sync failed:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * Get sync status
     */
    getStatus() {
        return {
            isSyncing: this.isSyncing,
            lastSyncTime: this.lastSyncTime,
            dbConnected: databaseService.isAvailable()
        };
    }
}

export default new SyncService();
