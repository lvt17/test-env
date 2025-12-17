import { v2 as cloudinary } from 'cloudinary';

/**
 * Cloudinary Service - Upload và quản lý ảnh
 */
class CloudinaryService {
  constructor() {
    this.isConfigured = false;
    this.configure();
  }

  /**
   * Cấu hình Cloudinary từ env vars
   */
  configure() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true
      });
      this.isConfigured = true;
      console.log('✅ Cloudinary configured');
    } else {
      console.warn('⚠️ Cloudinary not configured - missing env vars');
    }
  }

  /**
   * Upload ảnh từ buffer
   * @param {Buffer} buffer - File buffer
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result with url, public_id
   */
  async uploadFromBuffer(buffer, options = {}) {
    if (!this.isConfigured) {
      throw new Error('Cloudinary not configured');
    }

    const folder = options.folder || 'lumiglobal';
    const publicId = options.publicId || `bill_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folder,
          public_id: publicId,
          resource_type: 'image',
          transformation: [
            { quality: 'auto:good' },
            { fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve({
              success: true,
              url: result.secure_url,
              publicId: result.public_id,
              width: result.width,
              height: result.height,
              format: result.format,
              bytes: result.bytes
            });
          }
        }
      );

      uploadStream.end(buffer);
    });
  }

  /**
   * Upload ảnh từ URL
   * @param {string} imageUrl - URL của ảnh
   * @param {Object} options - Upload options
   */
  async uploadFromUrl(imageUrl, options = {}) {
    if (!this.isConfigured) {
      throw new Error('Cloudinary not configured');
    }

    const folder = options.folder || 'lumiglobal';
    const publicId = options.publicId || `bill_${Date.now()}`;

    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: folder,
      public_id: publicId,
      resource_type: 'image'
    });

    return {
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height
    };
  }

  /**
   * Xóa ảnh theo public_id
   * @param {string} publicId - Cloudinary public_id
   */
  async deleteImage(publicId) {
    if (!this.isConfigured) {
      throw new Error('Cloudinary not configured');
    }

    const result = await cloudinary.uploader.destroy(publicId);
    return {
      success: result.result === 'ok',
      result: result.result
    };
  }

  /**
   * Lấy URL thumbnail
   */
  getThumbnailUrl(publicId, width = 150, height = 150) {
    return cloudinary.url(publicId, {
      width: width,
      height: height,
      crop: 'fill',
      quality: 'auto'
    });
  }
}

export default new CloudinaryService();
