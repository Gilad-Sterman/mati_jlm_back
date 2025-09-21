// Load environment variables first
require('dotenv').config();

const { testConnection, supabase } = require('../config/database');
const MigrationRunner = require('./migrationRunner');
const DatabaseUtils = require('../utils/database');

/**
 * Initialize database with all tables and seed data
 */
async function initializeDatabase() {
  try {
    console.log('🔄 Initializing database...');

    // Test database connection
    console.log('🔍 Testing database connection...');
    const isConnected = await testConnection();
    if (!isConnected) {
      throw new Error('Database connection failed');
    }

    // Run migrations
    const migrationRunner = new MigrationRunner();
    await migrationRunner.runMigrations();

    // Verify database health
    const healthCheck = await DatabaseUtils.healthCheck();
    if (!healthCheck.healthy) {
      throw new Error(`Database health check failed: ${healthCheck.error}`);
    }

    console.log('✅ Database initialization completed successfully');
    return true;

  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    throw error;
  }
}

/**
 * Create seed data for development
 */
async function seedDatabase() {
  try {
    console.log('🌱 Seeding database with initial data...');

    // Check if we already have users (avoid duplicate seeding)
    const { data: existingUsers } = await supabase
      .from('users')
      .select('id')
      .limit(1);

    if (existingUsers && existingUsers.length > 0) {
      console.log('📋 Database already contains data, skipping seed');
      return;
    }

    // Create admin user
    const bcrypt = require('bcryptjs');
    const adminPassword = await bcrypt.hash('admin123', 12);

    const { data: adminUser, error: adminError } = await supabase
      .from('users')
      .insert({
        email: 'admin@mati.com',
        name: 'System Administrator',
        password_hash: adminPassword,
        role: 'admin',
        status: 'active'
      })
      .select()
      .single();

    if (adminError) throw adminError;

    // Create sample adviser
    const adviserPassword = await bcrypt.hash('adviser123', 12);

    const { data: adviser, error: adviserError } = await supabase
      .from('users')
      .insert({
        email: 'adviser@mati.com',
        name: 'Sample Adviser',
        password_hash: adviserPassword,
        role: 'adviser',
        status: 'active'
      })
      .select()
      .single();

    if (adviserError) throw adviserError;

    // Create sample client
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        name: 'John Doe',
        email: 'john.doe@example.com',
        phone: '+1-555-0123',
        adviser_id: adviser.id,
        metadata: {
          company: 'Sample Corp',
          industry: 'Technology'
        }
      })
      .select()
      .single();

    if (clientError) throw clientError;

    console.log('✅ Database seeded successfully');
    console.log(`👤 Admin user: admin@mati.com / admin123`);
    console.log(`👤 Adviser user: adviser@mati.com / adviser123`);

  } catch (error) {
    console.error('❌ Database seeding failed:', error.message);
    throw error;
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];

  switch (command) {
    case 'init':
      initializeDatabase()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
    
    case 'seed':
      initializeDatabase()
        .then(() => seedDatabase())
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
    
    case 'migrate':
      const migrationRunner = new MigrationRunner();
      migrationRunner.runMigrations()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
    
    default:
      console.log('Usage: node init.js [init|seed|migrate]');
      console.log('  init    - Initialize database with migrations');
      console.log('  seed    - Initialize and seed with sample data');
      console.log('  migrate - Run pending migrations only');
      process.exit(1);
  }
}

module.exports = {
  initializeDatabase,
  seedDatabase
};
