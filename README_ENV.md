# 🔧 Hướng Dẫn Cấu Hình Google Sheets (Dùng File Credentials)

## 1. Tạo Service Account trên Google Cloud

```bash
1. Truy cập: https://console.cloud.google.com/
2. Chọn project hoặc tạo mới
3. IAM & Admin > Service Accounts > Create Service Account
4. Nhập tên service account > Create
5. Skip phần Grant access (bấm Continue)
6. Click vào service account vừa tạo
7. Keys > Add Key > Create new key > JSON
8. Download file JSON về
```

## 2. Đặt File Credentials vào Project

```bash
# Đổi tên file thành sheetCredentials.json
mv ~/Downloads/your-project-xxxxx.json ./sheetCredentials.json

# Đặt vào thư mục gốc của backend
your-backend/
├── src/
├── package.json
└── sheetCredentials.json  ← Đặt ở đây
```

## 3. Share Google Sheet với Service Account

```
1. Mở file sheetCredentials.json
2. Copy email trong field "client_email" (ví dụ: my-service@project.iam.gserviceaccount.com)
3. Mở Google Sheet cần kết nối
4. Click "Share"
5. Paste email service account vào
6. Chọn quyền: Editor
7. Bỏ tick "Notify people" > Share
```

## 4. Lấy Spreadsheet ID

```
URL Sheet: https://docs.google.com/spreadsheets/d/1yUKSfBxvSF-ZOLMub0FAQRORjOQQ2ybK4hZ0h5f3xY4/edit
                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                    Copy phần này
```

## 5. Cấu Hình Backend

### Code đã có sẵn - KHÔNG CẦN SỬA

**File:** `src/services/googleSheets.service.js`

```javascript
// Backend tự động đọc từ file sheetCredentials.json
const KEYFILEPATH = path.join(__dirname, '../..', 'sheetCredentials.json');

async performAuthentication() {
  // Kiểm tra file tồn tại
  if (fs.existsSync(KEYFILEPATH)) {
    const auth = new google.auth.GoogleAuth({
      keyFile: KEYFILEPATH,  // ← Đọc từ file
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    this.authClient = await auth.getClient();
    this.sheetsAPI = google.sheets({ version: 'v4', auth: this.authClient });
  }
}
```

### Cấu Hình Spreadsheet ID

**Cách 1: Hardcode (Đơn giản)**

**File:** `src/services/googleSheets.service.js`

```javascript
// Dòng ~12
const SPREADSHEET_ID = '1yUKSfBxvSF-ZOLMub0FAQRORjOQQ2ybK4hZ0h5f3xY4'; // ← Thay ID của bạn
```

**Cách 2: Dùng .env (Linh hoạt hơn)**

**File:** `.env` (tạo mới ở thư mục gốc)
```bash
DEFAULT_SPREADSHEET_ID=1yUKSfBxvSF-ZOLMub0FAQRORjOQQ2ybK4hZ0h5f3xY4
```

**File:** `src/services/googleSheets.service.js`
```javascript
// Dòng ~12
const SPREADSHEET_ID = process.env.DEFAULT_SPREADSHEET_ID || '1yUKSfBxvSF-ZOLMub0FAQRORjOQQ2ybK4hZ0h5f3xY4';
```

**File:** `package.json`
```json
{
  "scripts": {
    "start": "node -r dotenv/config src/index.js"
  },
  "dependencies": {
    "dotenv": "^16.0.0"
  }
}
```

## 6. Chạy Backend

```bash
npm install
npm start
```

## 7. Test API

```bash
# Test update
curl -X PATCH "http://localhost:3000/sheet/F3/update-single" \
  -H "Content-Type: application/json" \
  -d '{"Mã đơn hàng": "DH001", "Trạng thái giao hàng NB": "Test"}'

# Kết quả mong đợi
{"success":true,"updated":1,"changedFields":1,"primaryKey":"DH001"}
```

## ✅ Checklist

- [ ] Tạo Service Account và download file JSON
- [ ] Đổi tên file thành `sheetCredentials.json`
- [ ] Đặt file vào thư mục gốc backend
- [ ] Copy email từ file JSON
- [ ] Share Sheet với email đó (quyền Editor)
- [ ] Copy Spreadsheet ID từ URL
- [ ] Sửa `SPREADSHEET_ID` trong code (hoặc tạo `.env`)
- [ ] Chạy `npm install && npm start`
- [ ] Test API update

## 🔒 Bảo Mật

```bash
# Thêm vào .gitignore
echo "sheetCredentials.json" >> .gitignore
echo ".env" >> .gitignore
```

## 🚀 Deploy lên Vercel/Hosting

**Lưu ý:** File `sheetCredentials.json` không thể upload lên Vercel.

**Giải pháp:** Dùng ENV variable thay thế:

1. Copy toàn bộ nội dung file `sheetCredentials.json`
2. Vào Vercel > Settings > Environment Variables
3. Thêm:
   - Name: `GOOGLE_CREDENTIALS`
   - Value: Paste toàn bộ JSON vào

Backend sẽ tự động ưu tiên ENV nếu có, fallback về file nếu không.
