/**
 * Google Apps Script - Sheet onChange Webhook
 * 
 * Hướng dẫn cài đặt:
 * 1. Mở Google Sheet → Extensions → Apps Script
 * 2. Copy toàn bộ code này vào editor
 * 3. Thay đổi WEBHOOK_URL thành URL backend của bạn
 * 4. Lưu và chạy hàm setupTrigger() một lần để cài đặt trigger
 * 
 * Lưu ý: Cần cấp quyền cho script khi chạy lần đầu
 */

// ========== CẤU HÌNH ==========
// Thay đổi URL này thành backend của bạn
const WEBHOOK_URL = 'https://test-env.vercel.app/webhook/sheet-change';

// Các sheet cần theo dõi (để trống = tất cả sheets)
const WATCHED_SHEETS = ['F3'];

// ========== HÀM CHÍNH ==========

/**
 * Trigger khi có thay đổi trong Sheet
 * Được gọi tự động bởi Google Apps Script trigger
 */
function onEdit(e) {
    try {
        const sheet = e.source.getActiveSheet();
        const sheetName = sheet.getName();

        // Kiểm tra xem sheet có trong danh sách cần theo dõi không
        if (WATCHED_SHEETS.length > 0 && !WATCHED_SHEETS.includes(sheetName)) {
            return; // Bỏ qua các sheet không cần theo dõi
        }

        const range = e.range;
        const row = range.getRow();
        const column = range.getColumn();

        // Lấy primary key (giả sử cột A là primary key)
        const primaryKey = sheet.getRange(row, 1).getValue();

        // Lấy tên cột (header)
        const headerRow = sheet.getRange(1, column).getValue();

        // Chuẩn bị payload
        const payload = {
            sheetName: sheetName,
            range: range.getA1Notation(),
            row: row,
            column: column,
            oldValue: e.oldValue || '',
            newValue: e.value || '',
            user: Session.getActiveUser().getEmail() || 'unknown',
            timestamp: new Date().toISOString(),
            primaryKey: primaryKey,
            changedFields: {
                [headerRow]: e.value
            }
        };

        // Gửi webhook
        sendWebhook(payload);

    } catch (error) {
        console.error('onEdit error:', error);
    }
}

/**
 * Trigger khi có thay đổi cấu trúc (thêm/xóa row, column)
 */
function onChange(e) {
    try {
        // Chỉ xử lý các thay đổi quan trọng
        if (e.changeType === 'INSERT_ROW' || e.changeType === 'REMOVE_ROW') {
            const sheet = e.source.getActiveSheet();
            const payload = {
                sheetName: sheet.getName(),
                changeType: e.changeType,
                timestamp: new Date().toISOString(),
                user: Session.getActiveUser().getEmail() || 'unknown'
            };

            sendWebhook(payload);
        }
    } catch (error) {
        console.error('onChange error:', error);
    }
}

/**
 * Gửi webhook đến backend
 */
function sendWebhook(payload) {
    try {
        const options = {
            method: 'POST',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true // Không throw error nếu request fail
        };

        const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
        const responseCode = response.getResponseCode();

        if (responseCode !== 200) {
            console.warn(`Webhook returned status ${responseCode}: ${response.getContentText()}`);
        } else {
            console.log('Webhook sent successfully:', payload.primaryKey || 'structure change');
        }

    } catch (error) {
        console.error('sendWebhook error:', error);
    }
}

// ========== HÀM SETUP ==========

/**
 * Chạy hàm này một lần để cài đặt trigger
 * Vào Extensions → Apps Script → Chạy hàm setupTrigger
 */
function setupTrigger() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Xóa các trigger cũ (nếu có)
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
        if (trigger.getHandlerFunction() === 'onEdit' ||
            trigger.getHandlerFunction() === 'onChange') {
            ScriptApp.deleteTrigger(trigger);
        }
    });

    // Tạo trigger onEdit
    ScriptApp.newTrigger('onEdit')
        .forSpreadsheet(ss)
        .onEdit()
        .create();

    // Tạo trigger onChange (cho thêm/xóa row)
    ScriptApp.newTrigger('onChange')
        .forSpreadsheet(ss)
        .onChange()
        .create();

    console.log('Triggers đã được cài đặt thành công!');
    SpreadsheetApp.getUi().alert('✅ Triggers đã được cài đặt thành công!\n\nBạn có thể đóng cửa sổ này.');
}

/**
 * Test webhook thủ công
 */
function testWebhook() {
    const testPayload = {
        sheetName: 'F3',
        range: 'A1',
        row: 1,
        column: 1,
        oldValue: 'test_old',
        newValue: 'test_new',
        user: Session.getActiveUser().getEmail(),
        timestamp: new Date().toISOString(),
        primaryKey: 'TEST_123',
        changedFields: { 'test_column': 'test_value' },
        isTest: true
    };

    sendWebhook(testPayload);
    SpreadsheetApp.getUi().alert('✅ Test webhook đã được gửi!\n\nKiểm tra console log để xem kết quả.');
}
