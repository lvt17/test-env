import express from 'express';
import multer from 'multer';
import cloudinaryService from '../services/cloudinary.service.js';

const router = express.Router();

// Cấu hình multer - lưu file vào memory buffer
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // Max 5MB
  },
  fileFilter: (req, file, cb) => {
    // Chỉ cho phép ảnh
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ cho phép upload file ảnh'), false);
    }
  }
});

/**
 * POST /upload/image
 * Upload một ảnh lên Cloudinary
 * Body: multipart/form-data với field 'image'
 */
router.post('/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Không tìm thấy file ảnh'
      });
    }

    const result = await cloudinaryService.uploadFromBuffer(req.file.buffer, {
      folder: 'lumiglobal/bills',
      publicId: `bill_${Date.now()}`
    });

    res.json(result);

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /upload/image-url
 * Upload ảnh từ URL
 * Body: { url: string }
 */
router.post('/image-url', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    const result = await cloudinaryService.uploadFromUrl(url, {
      folder: 'lumiglobal/bills'
    });

    res.json(result);

  } catch (error) {
    console.error('Upload from URL error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /upload/image/:publicId
 * Xóa ảnh theo public_id
 */
router.delete('/image/:publicId(*)', async (req, res) => {
  try {
    const { publicId } = req.params;

    if (!publicId) {
      return res.status(400).json({
        success: false,
        error: 'publicId is required'
      });
    }

    const result = await cloudinaryService.deleteImage(publicId);
    res.json(result);

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /upload/health
 * Kiểm tra trạng thái Cloudinary
 */
router.get('/health', (req, res) => {
  const isConfigured = !!process.env.CLOUDINARY_CLOUD_NAME;
  res.json({
    success: true,
    cloudinaryConfigured: isConfigured,
    timestamp: new Date().toISOString()
  });
});

export default router;
