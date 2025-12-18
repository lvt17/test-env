/**
 * Status Normalization Utilities
 * Provides centralized schema and normalization for all status values
 */

/**
 * Master Status Schema - Single source of truth
 * All values are lowercase + Unicode NFC normalized
 */
export const STATUS_SCHEMA = {
    "Kết quả Check": [
        "", "ok", "huỷ", "treo", "vận đơn xl", "đợi hàng", "khách hẹn"
    ],
    "Trạng thái giao hàng NB": [
        "", "giao thành công", "đang giao", "chưa giao", "huỷ", "hoàn",
        "chờ check", "giao không thành công", "bom_thất lạc"
    ],
    "Trạng thái thu tiền": [
        "", "có bill", "có bill 1 phần", "bom_bùng_chặn", "hẹn thanh toán",
        "hoàn hàng", "khó đòi", "không nhận được hàng", "không ph dưới 3n",
        "thanh toán phí hoàn", "kph nhiều ngày"
    ]
};

/**
 * Display mapping - for showing user-friendly text
 */
export const STATUS_DISPLAY = {
    "Kết quả Check": {
        "": "", "ok": "OK", "huỷ": "Huỷ", "treo": "Treo",
        "vận đơn xl": "Vận đơn XL", "đợi hàng": "Đợi hàng", "khách hẹn": "Khách hẹn"
    },
    "Trạng thái giao hàng NB": {
        "": "", "giao thành công": "Giao Thành Công", "đang giao": "Đang Giao",
        "chưa giao": "Chưa Giao", "huỷ": "Huỷ", "hoàn": "Hoàn", "chờ check": "Chờ Check",
        "giao không thành công": "Giao không thành công", "bom_thất lạc": "Bom_Thất Lạc"
    },
    "Trạng thái thu tiền": {
        "": "", "có bill": "Có bill", "có bill 1 phần": "Có bill 1 phần",
        "bom_bùng_chặn": "Bom_bùng_chặn", "hẹn thanh toán": "Hẹn Thanh Toán",
        "hoàn hàng": "Hoàn Hàng", "khó đòi": "Khó Đòi",
        "không nhận được hàng": "Không nhận được hàng",
        "không ph dưới 3n": "Không PH dưới 3N", "thanh toán phí hoàn": "Thanh toán phí hoàn",
        "kph nhiều ngày": "KPH nhiều ngày"
    }
};

/**
 * Status columns that need normalization (DB column names)
 */
export const STATUS_COLUMNS = [
    'ket_qua_check',
    'trang_thai_giao_hang_nb',
    'trang_thai_thu_tien'
];

/**
 * Normalize any string value:
 * 1. Apply Unicode NFC normalization (keyboard standard)
 * 2. Convert to lowercase
 * 3. Trim whitespace
 * 
 * @param {any} value - Value to normalize
 * @returns {string} Normalized string
 */
export function normalizeStatus(value) {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'string') return String(value).toLowerCase();

    return value
        .normalize('NFC')  // Unicode NFC (keyboard standard)
        .toLowerCase()
        .trim();
}

/**
 * Get display value for a normalized status
 * @param {string} column - Column name
 * @param {string} normalizedValue - Lowercase normalized value
 * @returns {string} Display value (title case)
 */
export function getDisplayValue(column, normalizedValue) {
    const displayMap = STATUS_DISPLAY[column];
    if (!displayMap) return normalizedValue;
    return displayMap[normalizedValue] || normalizedValue;
}

/**
 * Check if a value is valid for a column
 * @param {string} column - Column name
 * @param {string} value - Value to check
 * @returns {boolean}
 */
export function isValidStatus(column, value) {
    const schema = STATUS_SCHEMA[column];
    if (!schema) return true; // Not a status column

    const normalized = normalizeStatus(value);
    return schema.includes(normalized);
}

export default {
    STATUS_SCHEMA,
    STATUS_DISPLAY,
    STATUS_COLUMNS,
    normalizeStatus,
    getDisplayValue,
    isValidStatus
};
