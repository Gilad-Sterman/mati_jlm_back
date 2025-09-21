/**
 * Validation middleware for request data
 */

/**
 * Validate email format
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate UUID format
 */
const isValidUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Sanitize string input
 */
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str.trim().replace(/[<>]/g, ''); // Basic XSS prevention
};

/**
 * Validate login request
 */
const validateLogin = (req, res, next) => {
  const { email, password } = req.body;
  const errors = [];

  if (!email) {
    errors.push('Email is required');
  } else if (!isValidEmail(email)) {
    errors.push('Invalid email format');
  }

  if (!password) {
    errors.push('Password is required');
  } else if (password.length < 6) {
    errors.push('Password must be at least 6 characters long');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  // Sanitize inputs
  req.body.email = sanitizeString(email.toLowerCase());
  req.body.password = password; // Don't sanitize password

  next();
};

/**
 * Validate user creation request
 */
const validateCreateUser = (req, res, next) => {
  const { email, name, password, role } = req.body;
  const errors = [];

  if (!email) {
    errors.push('Email is required');
  } else if (!isValidEmail(email)) {
    errors.push('Invalid email format');
  }

  if (!name) {
    errors.push('Name is required');
  } else if (name.length < 2) {
    errors.push('Name must be at least 2 characters long');
  } else if (name.length > 255) {
    errors.push('Name must be less than 255 characters');
  }

  if (!password) {
    errors.push('Password is required');
  }

  if (role && !['admin', 'adviser'].includes(role)) {
    errors.push('Invalid role. Must be admin or adviser');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  // Sanitize inputs
  req.body.email = sanitizeString(email.toLowerCase());
  req.body.name = sanitizeString(name);
  req.body.role = role || 'adviser';

  next();
};

/**
 * Validate user update request
 */
const validateUpdateUser = (req, res, next) => {
  const { name, role, status } = req.body;
  const errors = [];

  if (name !== undefined) {
    if (typeof name !== 'string' || name.length < 2) {
      errors.push('Name must be at least 2 characters long');
    } else if (name.length > 255) {
      errors.push('Name must be less than 255 characters');
    }
  }

  if (role !== undefined && !['admin', 'adviser'].includes(role)) {
    errors.push('Invalid role. Must be admin or adviser');
  }

  if (status !== undefined && !['active', 'inactive', 'suspended'].includes(status)) {
    errors.push('Invalid status. Must be active, inactive, or suspended');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  // Sanitize inputs
  if (name !== undefined) {
    req.body.name = sanitizeString(name);
  }

  next();
};

/**
 * Validate client creation request
 */
const validateCreateClient = (req, res, next) => {
  const { name, email, phone, metadata } = req.body;
  const errors = [];

  if (!name) {
    errors.push('Client name is required');
  } else if (name.length < 2) {
    errors.push('Client name must be at least 2 characters long');
  } else if (name.length > 255) {
    errors.push('Client name must be less than 255 characters');
  }

  if (email && !isValidEmail(email)) {
    errors.push('Invalid email format');
  }

  if (phone && (phone.length < 10 || phone.length > 20)) {
    errors.push('Phone number must be between 10 and 20 characters');
  }

  // Validate metadata field (should be an object if provided)
  if (metadata !== undefined) {
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      errors.push('Metadata must be a valid object');
    } else {
      // Validate specific metadata fields if they exist
      if (metadata.business_domain && typeof metadata.business_domain === 'string' && metadata.business_domain.length > 255) {
        errors.push('Business domain must be less than 255 characters');
      }
      if (metadata.business_number && typeof metadata.business_number === 'string' && metadata.business_number.length > 100) {
        errors.push('Business number must be less than 100 characters');
      }
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  // Sanitize inputs
  req.body.name = sanitizeString(name);
  if (email) req.body.email = sanitizeString(email.toLowerCase());
  if (phone) req.body.phone = sanitizeString(phone);
  
  // Sanitize metadata object
  if (metadata && typeof metadata === 'object') {
    const sanitizedMetadata = {};
    Object.keys(metadata).forEach(key => {
      if (typeof metadata[key] === 'string') {
        sanitizedMetadata[key] = sanitizeString(metadata[key]);
      } else {
        sanitizedMetadata[key] = metadata[key];
      }
    });
    req.body.metadata = sanitizedMetadata;
  }

  next();
};

/**
 * Validate UUID parameter
 */
const validateUUIDParam = (paramName) => {
  return (req, res, next) => {
    const value = req.params[paramName];
    
    if (!value || !isValidUUID(value)) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${paramName} format`
      });
    }

    next();
  };
};

/**
 * Validate pagination parameters
 */
const validatePagination = (req, res, next) => {
  const { page = 1, limit = 10 } = req.query;
  
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  
  if (isNaN(pageNum) || pageNum < 1) {
    return res.status(400).json({
      success: false,
      message: 'Page must be a positive integer'
    });
  }
  
  if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return res.status(400).json({
      success: false,
      message: 'Limit must be between 1 and 100'
    });
  }
  
  req.pagination = {
    page: pageNum,
    limit: limitNum,
    offset: (pageNum - 1) * limitNum
  };
  
  next();
};

module.exports = {
  validateLogin,
  validateCreateUser,
  validateUpdateUser,
  validateCreateClient,
  validateUUIDParam,
  validatePagination,
  isValidEmail,
  isValidUUID,
  sanitizeString
};
