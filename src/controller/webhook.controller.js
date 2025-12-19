import syncQueueService from '../services/syncQueue.service.js';
import sseController from './sse.controller.js';
import databaseService from '../services/database.service.js';
import { normalizeStatus, STATUS_COLUMNS } from '../utils/statusNormalization.js';

/**
 * Normalize value - lowercase+NFC for status columns, NFC only for others
 */
function normalizeValue(value, dbColumn = null) {
    if (typeof value !== 'string') return value;
    if (dbColumn && STATUS_COLUMNS.includes(dbColumn)) {
        return normalizeStatus(value);
    }
    return value.normalize('NFC');
}

class WebhookController {
    /**
     * Handle sheet change webhook from Google Apps Script
     * POST /webhook/sheet-change
     * Updates DB so frontend can see changes via polling
     */
    async handleSheetChange(req, res) {
        try {
            const {
                sheetName,
                range,
                row,
                column,
                oldValue,
                newValue,
                user,
                timestamp,
                primaryKey,
                changedFields
            } = req.body;

            console.log(`📥 Webhook received: ${sheetName} - Row ${row} - Key: ${primaryKey}`);

            // Validate required fields
            if (!sheetName || !primaryKey) {
                return res.status(400).json({
                    success: false,
                    error: 'sheetName and primaryKey are required'
                });
            }

            // === Update database with Sheet changes (Unicode normalized) ===
            let dbUpdated = false;

            // Convert Sheet column names to DB column names (must match UpdateQueueService mapping)
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
                'Ngày Kế toán đối soát với FFM lần 2': 'ngay_doi_soat',
                'Team': 'team',
                'Khu vực': 'khu_vuc'
            };

            // Use fullRowData for new rows, changedFields for edits
            const dataSource = req.body.fullRowData || changedFields;

            if (primaryKey && dataSource && Object.keys(dataSource).length > 0) {
                try {
                    await databaseService.connect();

                    const dbUpdate = { ma_don_hang: primaryKey.normalize('NFC') };
                    for (const [sheetCol, value] of Object.entries(dataSource)) {
                        // Normalize column name for lookup
                        const normalizedCol = sheetCol.normalize('NFC');
                        const dbCol = sheetToDbMapping[normalizedCol];
                        if (dbCol && value !== undefined && value !== '') {
                            // Apply lowercase normalization for status columns
                            dbUpdate[dbCol] = normalizeValue(value, dbCol);
                        }
                    }

                    // Pass source: 'sheet' for proper conflict resolution
                    await databaseService.upsertOrder(dbUpdate, { source: 'sheet' });
                    dbUpdated = true;
                    const isNewRow = req.body.isNewRow ? '(NEW)' : '(UPDATE)';
                    console.log(`✅ DB ${isNewRow} for ${primaryKey}:`, Object.keys(dataSource).length, 'fields');
                } catch (dbErr) {
                    console.error(`❌ DB update failed:`, dbErr.message);
                }
            }

            // Record the external change for polling
            const changeData = {
                sheetName,
                range,
                row,
                column,
                oldValue,
                newValue,
                user,
                timestamp: timestamp || new Date().toISOString(),
                primaryKey,
                changedFields
            };

            const version = syncQueueService.recordExternalChange(sheetName, changeData);

            // Broadcast change to all SSE clients
            const clientsNotified = sseController.broadcast(sheetName, {
                type: 'sheet_change',
                ...changeData,
                version
            });

            res.json({
                success: true,
                message: 'Change recorded',
                dbUpdated,
                version,
                clientsNotified
            });

        } catch (error) {
            console.error('❌ Webhook error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Health check endpoint
     * GET /webhook/health
     */
    async health(req, res) {
        const stats = syncQueueService.getStats();

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            queueStats: stats
        });
    }

    /**
     * Get pending changes for debugging
     * GET /webhook/debug/changes/:sheetName
     */
    async getDebugChanges(req, res) {
        const { sheetName } = req.params;
        const { since = 0 } = req.query;

        const changes = syncQueueService.getChangesSince(sheetName, parseInt(since));

        res.json({
            success: true,
            sheetName,
            since: parseInt(since),
            changes,
            count: changes.length
        });
    }
}

export default new WebhookController();
