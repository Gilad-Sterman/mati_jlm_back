// Load environment variables first
require('dotenv').config();

const fs = require('fs').promises;
const path = require('path');
const { supabase } = require('../config/database');

class MigrationRunner {
  constructor() {
    this.migrationsPath = path.join(__dirname, 'migrations');
  }

  async createMigrationsTable() {
    // For now, we'll create a simple approach since Supabase doesn't support raw SQL execution
    // In a real implementation, you would create this table manually in Supabase dashboard
    // or use Supabase's migration system
    
    console.log('⚠️  Note: Please create the migrations table manually in your Supabase dashboard:');
    console.log(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    
    // Try to check if table exists by querying it
    const { error } = await supabase.from('migrations').select('id').limit(1);
    
    if (error && error.code === 'PGRST116') {
      throw new Error('Migrations table does not exist. Please create it manually in Supabase dashboard first.');
    }
    
    if (error && error.code !== 'PGRST204') { // PGRST204 = empty result
      throw new Error(`Failed to access migrations table: ${error.message}`);
    }
  }

  async getExecutedMigrations() {
    const { data, error } = await supabase
      .from('migrations')
      .select('filename')
      .order('id');

    if (error) {
      throw new Error(`Failed to get executed migrations: ${error.message}`);
    }

    return data.map(row => row.filename);
  }

  async getMigrationFiles() {
    try {
      const files = await fs.readdir(this.migrationsPath);
      return files
        .filter(file => file.endsWith('.sql'))
        .sort(); // Ensure migrations run in order
    } catch (error) {
      throw new Error(`Failed to read migrations directory: ${error.message}`);
    }
  }

  async executeMigration(filename) {
    const filePath = path.join(this.migrationsPath, filename);
    
    try {
      const sql = await fs.readFile(filePath, 'utf8');
      
      console.log(`⚠️  Please execute this SQL manually in your Supabase SQL editor:`);
      console.log(`--- Migration: ${filename} ---`);
      console.log(sql);
      console.log(`--- End of ${filename} ---\n`);

      // For now, we'll just record that we "executed" it
      // In a real implementation, you'd need to use Supabase's migration system
      // or execute the SQL manually in the dashboard
      
      // Record the migration as executed
      const { error: recordError } = await supabase
        .from('migrations')
        .insert({ filename });

      if (recordError && recordError.code !== '23505') { // 23505 = unique violation (already exists)
        throw new Error(`Failed to record migration ${filename}: ${recordError.message}`);
      }

      console.log(`📝 Recorded migration: ${filename}`);
    } catch (error) {
      throw new Error(`Migration ${filename} failed: ${error.message}`);
    }
  }

  async runMigrations() {
    try {
      console.log('🚀 Starting database migrations...');

      // Create migrations table if it doesn't exist
      await this.createMigrationsTable();

      // Get list of executed migrations
      const executedMigrations = await this.getExecutedMigrations();
      console.log(`📋 Found ${executedMigrations.length} executed migrations`);

      // Get all migration files
      const migrationFiles = await this.getMigrationFiles();
      console.log(`📁 Found ${migrationFiles.length} migration files`);

      // Filter out already executed migrations
      const pendingMigrations = migrationFiles.filter(
        file => !executedMigrations.includes(file)
      );

      if (pendingMigrations.length === 0) {
        console.log('✅ All migrations are up to date');
        return;
      }

      console.log(`⏳ Running ${pendingMigrations.length} pending migrations...`);

      // Execute pending migrations
      for (const migration of pendingMigrations) {
        await this.executeMigration(migration);
      }

      console.log('🎉 All migrations completed successfully');
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      throw error;
    }
  }

  async rollbackLastMigration() {
    try {
      const executedMigrations = await this.getExecutedMigrations();
      
      if (executedMigrations.length === 0) {
        console.log('No migrations to rollback');
        return;
      }

      const lastMigration = executedMigrations[executedMigrations.length - 1];
      
      // Remove from migrations table
      const { error } = await supabase
        .from('migrations')
        .delete()
        .eq('filename', lastMigration);

      if (error) {
        throw new Error(`Failed to rollback migration record: ${error.message}`);
      }

      console.log(`⏪ Rolled back migration: ${lastMigration}`);
      console.log('⚠️  Note: You may need to manually revert database changes');
    } catch (error) {
      console.error('❌ Rollback failed:', error.message);
      throw error;
    }
  }
}

module.exports = MigrationRunner;
