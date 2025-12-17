/**
 * Mock Data Generator for Testing
 * Generates realistic Vietnamese order data
 */

// Vietnamese name pool
const firstNames = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương'];
const middleNames = ['Văn', 'Thị', 'Hữu', 'Minh', 'Quốc', 'Thanh', 'Đức', 'Hồng', 'Kim', 'Xuân'];
const lastNames = ['An', 'Bình', 'Cường', 'Dũng', 'Em', 'Giang', 'Hải', 'Kiên', 'Linh', 'Mai', 'Nam', 'Phong', 'Quang', 'Sơn', 'Tùng', 'Vy'];

// Address pool
const streets = ['Lê Lợi', 'Nguyễn Huệ', 'Trần Hưng Đạo', 'Điện Biên Phủ', 'Lý Thường Kiệt', 'Hai Bà Trưng', 'Cách Mạng Tháng 8', 'Võ Văn Tần', 'Nam Kỳ Khởi Nghĩa'];
const cities = [
    { city: 'Hà Nội', state: 'HN' },
    { city: 'TP.HCM', state: 'SG' },
    { city: 'Đà Nẵng', state: 'DN' },
    { city: 'Cần Thơ', state: 'CT' },
    { city: 'Huế', state: 'TTH' },
    { city: 'Nha Trang', state: 'KH' },
    { city: 'Hải Phòng', state: 'HP' },
    { city: 'Biên Hòa', state: 'ĐN' }
];

// Status options (from schema)
const ketQuaCheck = ['OK', 'Treo', 'Hủy', 'Check', 'Chờ xử lý'];
const trangThaiGiaoHang = ['Chưa Giao', 'Đang Giao', 'Giao Thành Công', 'Giao không thành công', 'chờ check', 'Hoàn hàng'];
const trangThaiThuTien = ['Chưa thu', 'Có bill', 'Có bill 1 phần', 'Hoàn tiền', 'Hoàn Hàng'];
const lyDo = ['Hàng đẹp', 'Hết hàng', 'Sửa địa chỉ', 'KH không nghe máy', 'Đổi size', 'Nhật Bản', 'Hàn Quốc', 'Trung Quốc', null];

// Product pool
const products = ['Áo thun', 'Quần jean', 'Váy đầm', 'Túi xách', 'Giày dép', 'Mỹ phẩm', 'Đồng hồ', 'Phụ kiện', 'Nước hoa', 'Kính mắt'];

/**
 * Random helper functions
 */
function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(start, end) {
    const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    return d.toISOString().split('T')[0];
}

function generatePhone() {
    return '09' + randomInt(10000000, 99999999).toString();
}

/**
 * Generate a single mock order
 */
export function generateMockOrder(index) {
    const cityData = randomItem(cities);
    const price = randomInt(50, 500) * 1000; // 50K - 500K VND

    return {
        ma_don_hang: `DH${String(index).padStart(5, '0')}`,
        ma_tracking: `TRACK${String(index).padStart(6, '0')}`,
        ngay_len_don: randomDate(new Date('2023-01-01'), new Date('2024-12-31')),
        name: `${randomItem(firstNames)} ${randomItem(middleNames)} ${randomItem(lastNames)}`,
        phone: generatePhone(),
        address: `${randomInt(1, 999)} ${randomItem(streets)}`,
        city: cityData.city,
        state: cityData.state,
        mat_hang: randomItem(products),
        ten_mat_hang_1: `${randomItem(products)} - Size ${randomItem(['S', 'M', 'L', 'XL'])}`,
        so_luong_mat_hang_1: randomInt(1, 3),
        ket_qua_check: randomItem(ketQuaCheck),
        trang_thai_giao_hang_nb: randomItem(trangThaiGiaoHang),
        ly_do: randomItem(lyDo),
        trang_thai_thu_tien: randomItem(trangThaiThuTien),
        gia_ban: price,
        tong_tien_vnd: price,
        nhan_vien_sale: `NV${randomInt(1, 20)}`,
        team: `Team ${randomItem(['A', 'B', 'C', 'D'])}`,
        khu_vuc: randomItem(['Miền Bắc', 'Miền Trung', 'Miền Nam'])
    };
}

/**
 * Generate multiple mock orders
 */
export function generateMockOrders(count, startIndex = 1) {
    const orders = [];
    for (let i = 0; i < count; i++) {
        orders.push(generateMockOrder(startIndex + i));
    }
    return orders;
}

export default { generateMockOrder, generateMockOrders };
