const { v2: cloudinary } = require('cloudinary');

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Validate configuration
const validateConfig = () => {
  const requiredVars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.warn(`⚠️  Missing Cloudinary configuration: ${missing.join(', ')}`);
    return false;
  }
  
  console.log('✅ Cloudinary configuration loaded');
  return true;
};

// Upload presets for different file types
const uploadPresets = {
  audio: {
    resource_type: 'video', // Cloudinary treats audio as video
    folder: 'mati/recordings',
    allowed_formats: ['mp3', 'wav', 'm4a', 'aac', 'ogg'],
    max_file_size: 100000000, // 100MB
    quality: 'auto'
  },
  document: {
    resource_type: 'raw',
    folder: 'mati/documents',
    allowed_formats: ['pdf', 'doc', 'docx'],
    max_file_size: 50000000 // 50MB
  },
  image: {
    resource_type: 'image',
    folder: 'mati/images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    max_file_size: 10000000, // 10MB
    quality: 'auto',
    fetch_format: 'auto'
  }
};

module.exports = {
  cloudinary,
  uploadPresets,
  validateConfig
};
