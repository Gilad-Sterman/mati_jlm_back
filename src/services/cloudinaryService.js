const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Cloudinary immediately when module loads
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

class CloudinaryService {

  /**
   * Get Cloudinary configuration status
   */
  static getConfigStatus() {
    const requiredVars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    return {
      isConfigured: missing.length === 0,
      missing,
      config: {
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? '✓ Set' : '✗ Missing',
        api_key: process.env.CLOUDINARY_API_KEY ? '✓ Set' : '✗ Missing',
        api_secret: process.env.CLOUDINARY_API_SECRET ? '✓ Set' : '✗ Missing'
      },
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'Not configured'
    };
  }

  /**
   * Create multer storage for temporary file uploads
   */
  static createTempStorage() {
    return multer.diskStorage({
      destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/temp');
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        // Generate unique filename with timestamp
        const timestamp = Date.now();
        const originalName = path.parse(file.originalname).name;
        const sanitizedName = originalName.replace(/[^a-zA-Z0-9]/g, '_');
        const extension = path.extname(file.originalname);
        cb(null, `${timestamp}_${sanitizedName}${extension}`);
      }
    });
  }

  /**
   * Create multer upload middleware for audio/video
   */
  static createUploadMiddleware() {
    const storage = this.createTempStorage();
    
    return multer({
      storage: storage,
      limits: {
        fileSize: 500 * 1024 * 1024, // 500MB limit
        files: 1 // Only one file at a time
      },
      fileFilter: (req, file, cb) => {
        // Allowed MIME types for audio/video
        const allowedMimeTypes = [
          'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/flac',
          'video/mp4', 'video/avi', 'video/quicktime', 'video/webm'
        ];
        
        if (allowedMimeTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error(`Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`), false);
        }
      }
    });
  }

  /**
   * Upload temporary file to Cloudinary and clean up
   */
  static async uploadTempFile(tempFilePath, originalName, options = {}) {
    try {
      // Check if Cloudinary is configured
      const configStatus = this.getConfigStatus();
      if (!configStatus.isConfigured) {
        throw new Error(`Cloudinary not configured. Missing: ${configStatus.missing.join(', ')}`);
      }

      // Generate unique public_id
      const timestamp = Date.now();
      const sanitizedName = path.parse(originalName).name.replace(/[^a-zA-Z0-9]/g, '_');
      const publicId = `${timestamp}_${sanitizedName}`;

      const defaultOptions = {
        folder: 'mati/recordings',
        resource_type: 'auto',
        quality: 'auto',
        fetch_format: 'auto',
        public_id: publicId
      };

      const uploadOptions = { ...defaultOptions, ...options };
      
      console.log('🔍 Cloudinary upload options:', {
        ...uploadOptions,
        api_key: process.env.CLOUDINARY_API_KEY ? '***SET***' : 'MISSING'
      });
      
      const result = await cloudinary.uploader.upload(tempFilePath, uploadOptions);
      
      // Clean up temporary file
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.warn('Failed to clean up temp file:', cleanupError.message);
      }
      
      return {
        success: true,
        data: {
          public_id: result.public_id,
          secure_url: result.secure_url,
          url: result.url,
          format: result.format,
          resource_type: result.resource_type,
          bytes: result.bytes,
          duration: result.duration, // For audio/video files
          width: result.width, // For video files
          height: result.height, // For video files
          created_at: result.created_at,
          original_filename: originalName
        }
      };
    } catch (error) {
      // Clean up temporary file on error
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.warn('Failed to clean up temp file after error:', cleanupError.message);
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Upload file directly to Cloudinary (for programmatic uploads)
   */
  static async uploadFile(filePath, options = {}) {
    try {
      const defaultOptions = {
        folder: 'mati/recordings',
        resource_type: 'auto',
        quality: 'auto',
        fetch_format: 'auto'
      };

      const uploadOptions = { ...defaultOptions, ...options };
      const result = await cloudinary.uploader.upload(filePath, uploadOptions);
      
      return {
        success: true,
        data: {
          public_id: result.public_id,
          secure_url: result.secure_url,
          url: result.url,
          format: result.format,
          resource_type: result.resource_type,
          bytes: result.bytes,
          duration: result.duration, // For audio/video files
          width: result.width, // For video files
          height: result.height, // For video files
          created_at: result.created_at
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete file from Cloudinary
   */
  static async deleteFile(publicId, resourceType = 'auto') {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType
      });
      
      return {
        success: result.result === 'ok',
        result: result.result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate signed upload URL for direct client uploads
   */
  static generateSignedUploadUrl(options = {}) {
    try {
      const timestamp = Math.round(new Date().getTime() / 1000);
      
      const params = {
        timestamp: timestamp,
        folder: 'mati/recordings',
        resource_type: 'auto',
        ...options
      };

      const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);
      
      return {
        success: true,
        data: {
          url: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
          params: {
            ...params,
            signature,
            api_key: process.env.CLOUDINARY_API_KEY
          }
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get file information from Cloudinary
   */
  static async getFileInfo(publicId, resourceType = 'auto') {
    try {
      const result = await cloudinary.api.resource(publicId, {
        resource_type: resourceType
      });
      
      return {
        success: true,
        data: {
          public_id: result.public_id,
          format: result.format,
          resource_type: result.resource_type,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          duration: result.duration,
          created_at: result.created_at,
          secure_url: result.secure_url
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate optimized URL for file delivery
   */
  static generateOptimizedUrl(publicId, options = {}) {
    try {
      const defaultOptions = {
        quality: 'auto',
        fetch_format: 'auto'
      };

      const transformOptions = { ...defaultOptions, ...options };
      const url = cloudinary.url(publicId, transformOptions);
      
      return {
        success: true,
        url: url
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * List files in a folder
   */
  static async listFiles(folderPath = 'mati/recordings', maxResults = 100) {
    try {
      const result = await cloudinary.api.resources({
        type: 'upload',
        prefix: folderPath,
        max_results: maxResults,
        resource_type: 'auto'
      });
      
      return {
        success: true,
        data: {
          resources: result.resources,
          total_count: result.total_count,
          next_cursor: result.next_cursor
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get storage usage statistics
   */
  static async getUsageStats() {
    try {
      const result = await cloudinary.api.usage();
      
      return {
        success: true,
        data: {
          storage: {
            used_bytes: result.storage.used_bytes,
            used_percent: result.storage.used_percent,
            limit: result.storage.limit
          },
          bandwidth: {
            used_bytes: result.bandwidth.used_bytes,
            used_percent: result.bandwidth.used_percent,
            limit: result.bandwidth.limit
          },
          requests: result.requests,
          resources: result.resources,
          derived_resources: result.derived_resources
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = CloudinaryService;
