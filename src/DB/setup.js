// Load environment variables first
require('dotenv').config();

const { testConnection, supabase, supabaseAdmin } = require('../config/database');
const bcrypt = require('bcryptjs');

/**
 * Simple database setup for Supabase
 * This script will create sample data and test the connection
 */
async function setupDatabase() {
  try {
    console.log('🔄 Setting up database...');

    // Test database connection
    console.log('🔍 Testing database connection...');
    const isConnected = await testConnection();
    if (!isConnected) {
      throw new Error('Database connection failed');
    }

    console.log('✅ Database connection successful');

    // Check if tables exist by trying to query them
    const tablesExist = await checkTablesExist();
    
    if (!tablesExist) {
      console.log('📋 Tables not found. Please create them first.');
      return false;
    }

    console.log('✅ Database setup completed successfully');
    console.log('\n📋 Next steps:');
    console.log('1. Go to your Supabase dashboard → SQL Editor');
    console.log('2. Execute the SQL files in src/DB/migrations/ in order');
    console.log('3. Run "npm run db:seed" to add sample data');

    return true;

  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    
    if (error.message.includes('relation') && error.message.includes('does not exist')) {
      console.log('\n📋 Tables not found. Please:');
      console.log('1. Go to your Supabase dashboard → SQL Editor');
      console.log('2. Execute the SQL files in src/DB/migrations/ in order:');
      console.log('   - 001_create_users_table.sql');
      console.log('   - 002_create_clients_table.sql');
      console.log('   - 003_create_sessions_table.sql');
      console.log('   - 004_create_reports_table.sql');
      console.log('   - 005_create_report_versions_view.sql');
      console.log('   - 006_create_jobs_table.sql');
    }
    
    throw error;
  }
}

async function checkTablesExist() {
  const tables = ['users', 'clients', 'sessions', 'reports', 'jobs'];
  let allTablesExist = true;
  
  for (const table of tables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .limit(1);
      
      if (error) {
        if (error.code === 'PGRST116') {
          console.log(`❌ Table '${table}' does not exist (${error.code})`);
        } else {
          console.log(`❌ Table '${table}' error: ${error.message} (${error.code})`);
        }
        allTablesExist = false;
      } else {
        console.log(`✅ Table '${table}' exists`);
      }
    } catch (error) {
      console.log(`❌ Table '${table}' does not exist or is not accessible: ${error.message}`);
      allTablesExist = false;
    }
  }
  
  return allTablesExist;
}

/**
 * Create seed data for development
 */
async function seedDatabase() {
  try {
    console.log('🌱 Seeding database with initial data...');

    // Use admin client to bypass RLS for seeding
    const dbClient = supabaseAdmin || supabase;
    
    if (!supabaseAdmin) {
      console.log('⚠️  No service key provided. Using regular client (may fail due to RLS)');
    }

    // Check if we already have users (avoid duplicate seeding)
    const { data: existingUsers } = await dbClient
      .from('users')
      .select('id')
      .limit(1);

    if (existingUsers && existingUsers.length > 0) {
      console.log('📋 Database already contains data, skipping seed');
      return;
    }

    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 12);

    const { data: adminUser, error: adminError } = await dbClient
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

    const { data: adviser, error: adviserError } = await dbClient
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
    const { data: clientData, error: clientError } = await dbClient
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
    console.log(`👥 Sample client: ${clientData.name}`);

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
      setupDatabase()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
    
    case 'seed':
      setupDatabase()
        .then(() => seedDatabase())
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
    
    case 'check':
      setupDatabase()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
    
    default:
      console.log('Usage: node setup.js [init|seed|check]');
      console.log('  init  - Test connection and check tables');
      console.log('  seed  - Test connection and seed with sample data');
      console.log('  check - Test connection only');
      process.exit(1);
  }
}

module.exports = {
  setupDatabase,
  seedDatabase
};
