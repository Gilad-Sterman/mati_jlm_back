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
        files: 10 // Allow up to 10 files for concatenation
      },
      // Ensure proper UTF-8 handling for filenames
      preservePath: false,
      encoding: 'utf8',
      fileFilter: (req, file, cb) => {
        // Allowed MIME types for audio/video
        const allowedMimeTypes = [
          'audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/ogg',
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
   * Get optimized upload options based on file type for compression
   */
  static getOptimizedUploadOptions(originalName, fileType, customOptions = {}) {
    const timestamp = Date.now();
    const sanitizedName = path.parse(originalName).name.replace(/[^a-zA-Z0-9]/g, '_');
    const publicId = `${timestamp}_${sanitizedName}`;

    // Base options
    const baseOptions = {
      folder: 'mati/recordings',
      public_id: publicId,
      quality: 'auto'
    };

    // Detect file type and apply appropriate compression
    const isVideo = fileType && fileType.startsWith('video/');
    const isAudio = fileType && fileType.startsWith('audio/');

    if (isVideo) {
      // For video files: extract audio only and compress to MP3
      console.log(`🎥 Video detected → extracting audio`);
      return {
        ...baseOptions,
        resource_type: 'video',
        format: 'mp3',           // Convert video to audio-only MP3
        bit_rate: '64k',         // Optimize bitrate for speech
        quality: 'auto',         // Automatic quality optimization
        flags: 'strip_profile'   // Remove metadata to reduce size
      };
    } else if (isAudio) {
      // For audio files: compress and optimize aggressively
      console.log(`🎵 Audio detected → compressing`);
      return {
        ...baseOptions,
        resource_type: 'video',  // Cloudinary treats audio as 'video' resource type
        format: 'mp3',           // Convert to MP3 for consistency and compression
        bit_rate: '32k',         // More aggressive compression for speech (32k still good for voice)
        quality: 'auto',         // Automatic quality optimization
        flags: 'strip_profile'   // Remove metadata to reduce size
      };
    } else {
      // Fallback for other file types
      console.log(`📄 Other file type → standard upload`);
      return {
        ...baseOptions,
        resource_type: 'auto',
        fetch_format: 'auto'
      };
    }
  }

  /**
   * Upload temporary file to Cloudinary with intelligent compression
   */
  static async uploadTempFile(tempFilePath, originalName, options = {}) {
    let uploadOptions = null; // Declare outside try block for error logging
    
    try {
      // Check if Cloudinary is configured
      const configStatus = this.getConfigStatus();
      if (!configStatus.isConfigured) {
        throw new Error(`Cloudinary not configured. Missing: ${configStatus.missing.join(', ')}`);
      }

      // Get file stats for logging
      const stats = fs.statSync(tempFilePath);
      const originalSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      // Detect file type from the temporary file if not provided in options
      const fileType = options.fileType || this.detectFileType(tempFilePath);
      
      // Get optimized upload options based on file type
      const optimizedOptions = this.getOptimizedUploadOptions(originalName, fileType, options);
      
      // Merge with any custom options (custom options take precedence)
      uploadOptions = { 
        ...optimizedOptions, 
        ...options,
        timeout: 120000  // 2 minutes timeout for large files
      };

      console.log(`📤 Uploading ${originalName} (${originalSizeMB}MB) → MP3 ${uploadOptions.bit_rate} compression`);

      // Warn about very large files
      if (parseFloat(originalSizeMB) > 20) {
        console.log(`⏳ Large file processing - this may take 1-2 minutes...`);
      }
      
      
      const result = await cloudinary.uploader.upload(tempFilePath, uploadOptions);
      
      // Log compression results
      const compressedSizeMB = (result.bytes / (1024 * 1024)).toFixed(2);
      const compressionRatio = ((1 - (result.bytes / stats.size)) * 100).toFixed(1);
      
      console.log(`✅ Compressed: ${originalSizeMB}MB → ${compressedSizeMB}MB (${compressionRatio}% reduction) | ${result.duration ? Math.round(result.duration/60) + 'min' : 'N/A'}`);
      
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
          original_filename: originalName,
          // Add compression metadata
          compression_info: {
            original_size_mb: parseFloat(originalSizeMB),
            compressed_size_mb: parseFloat(compressedSizeMB),
            compression_ratio_percent: parseFloat(compressionRatio),
            original_format: path.extname(originalName).toLowerCase(),
            compressed_format: result.format
          }
        }
      };
    } catch (error) {
      console.error(`❌ Cloudinary upload failed for ${originalName}:`, error);
      console.error('Upload options used:', uploadOptions);
      
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
   * Upload PDF report to Cloudinary in reports folder
   */
  static async uploadPdfReport(pdfFile, reportId, sessionId, options = {}) {
    try {
      // Check if Cloudinary is configured
      const configStatus = this.getConfigStatus();
      if (!configStatus.isConfigured) {
        throw new Error(`Cloudinary not configured. Missing: ${configStatus.missing.join(', ')}`);
      }

      // Generate unique filename for the PDF
      const timestamp = Date.now();
      const publicId = `report_${reportId}_${timestamp}`;

      // Default options for PDF uploads - save as JPG images to bypass restrictions
      const defaultOptions = {
        folder: 'mati/reports',
        public_id: publicId,
        resource_type: 'image',
        format: 'jpg', // Convert PDF to JPG image format
        quality: 'auto',
        pages: true, // Convert all PDF pages
        density: 150 // Good quality for viewing
      };

      const uploadOptions = { ...defaultOptions, ...options };

      console.log(`📄 Uploading PDF report ${reportId} to Cloudinary...`);

      let result;
      
      // Handle different input types
      if (typeof pdfFile === 'string') {
        // File path provided
        result = await cloudinary.uploader.upload(pdfFile, uploadOptions);
      } else if (pdfFile.path) {
        // Multer file object with path
        result = await cloudinary.uploader.upload(pdfFile.path, uploadOptions);
      } else if (pdfFile.buffer) {
        // Buffer provided - convert to base64
        const base64Data = `data:application/pdf;base64,${pdfFile.buffer.toString('base64')}`;
        result = await cloudinary.uploader.upload(base64Data, uploadOptions);
      } else {
        throw new Error('Invalid PDF file format. Expected file path, multer file object, or buffer.');
      }

      const fileSizeMB = (result.bytes / (1024 * 1024)).toFixed(2);
      console.log(`✅ PDF uploaded successfully: ${fileSizeMB}MB | URL: ${result.secure_url}`);

      // Clean up temporary file if it exists
      if (pdfFile.path) {
        try {
          fs.unlinkSync(pdfFile.path);
          console.log(`🗑️ Cleaned up temporary PDF file: ${pdfFile.path}`);
        } catch (cleanupError) {
          console.warn('Failed to clean up temp PDF file:', cleanupError.message);
        }
      }

      // Use regular Cloudinary URL since we're now saving as JPG images
      const imageUrl = result.secure_url;
      
      console.log(`�️ Generated image URL: ${imageUrl}`);

      return {
        success: true,
        data: {
          public_id: result.public_id,
          secure_url: imageUrl, // Use image URL instead of proxy URL
          url: result.url,
          format: result.format,
          resource_type: result.resource_type,
          bytes: result.bytes,
          pages: result.pages, // Number of pages in PDF
          created_at: result.created_at,
          report_id: reportId,
          session_id: sessionId,
          file_info: {
            size_mb: parseFloat(fileSizeMB),
            original_filename: pdfFile.originalname || `report_${reportId}.pdf`
          }
        }
      };
    } catch (error) {
      console.error(`❌ Failed to upload PDF report ${reportId}:`, error);
      
      // Clean up temporary file on error
      if (pdfFile.path) {
        try {
          fs.unlinkSync(pdfFile.path);
        } catch (cleanupError) {
          console.warn('Failed to clean up temp PDF file after error:', cleanupError.message);
        }
      }
      
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

  /**
   * Detect file type from file path extension
   */
  static detectFileType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    
    // Audio file extensions
    const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma'];
    // Video file extensions  
    const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v'];
    
    if (audioExtensions.includes(extension)) {
      return `audio/${extension.slice(1)}`; // Remove the dot
    } else if (videoExtensions.includes(extension)) {
      return `video/${extension.slice(1)}`; // Remove the dot
    } else {
      return 'application/octet-stream'; // Default fallback
    }
  }
}

module.exports = CloudinaryService;
