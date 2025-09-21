const authConfig = {
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRATION || '24h',
    refreshExpiresIn: '7d'
  },
  bcrypt: {
    saltRounds: 12
  },
  roles: {
    ADMIN: 'admin',
    ADVISER: 'adviser',
    CLIENT: 'client'
  },
  permissions: {
    admin: [
      'users:read',
      'users:write',
      'users:delete',
      'sessions:read',
      'sessions:write',
      'sessions:delete',
      'reports:read',
      'reports:write',
      'reports:delete',
      'admin:dashboard',
      'admin:metrics'
    ],
    adviser: [
      'sessions:read',
      'sessions:write',
      'reports:read',
      'reports:write',
      'profile:read',
      'profile:write'
    ],
    client: [
      'profile:read'
    ]
  }
};

// Validate JWT secret in production
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production');
}

module.exports = authConfig;
