const { supabase, supabaseAdmin } = require('../config/database');

class JobService {
  /**
   * Create a new job in the queue
   */
  static async createJob(jobData) {
    try {
      const {
        session_id,
        type,
        payload = {},
        priority = 0,
        max_attempts = 3,
        scheduled_at = new Date()
      } = jobData;

      const { data, error } = await supabaseAdmin
        .from('jobs')
        .insert([{
          session_id,
          type,
          payload,
          priority,
          max_attempts,
          scheduled_at,
          status: 'pending'
        }])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create job: ${error.message}`);
      }

      console.log(`✅ Created ${type} job for session ${session_id}:`, data.id);
      return data;

    } catch (error) {
      console.error('Error creating job:', error);
      throw error;
    }
  }

  /**
   * Get next job from queue (using the database function)
   */
  static async getNextJob() {
    try {
      const { data, error } = await supabaseAdmin
        .rpc('get_next_job');

      if (error) {
        throw new Error(`Failed to get next job: ${error.message}`);
      }

      return data.length > 0 ? data[0] : null;

    } catch (error) {
      console.error('Error getting next job:', error);
      throw error;
    }
  }

  /**
   * Update job status and metadata
   */
  static async updateJob(jobId, updates) {
    try {
      const updateData = {
        ...updates,
        updated_at: new Date()
      };

      // If status is changing to 'processing', set started_at
      if (updates.status === 'processing') {
        updateData.started_at = new Date();
      }

      // If status is changing to 'completed' or 'failed', set completed_at
      if (updates.status === 'completed' || updates.status === 'failed') {
        updateData.completed_at = new Date();
      }

      const { data, error } = await supabaseAdmin
        .from('jobs')
        .update(updateData)
        .eq('id', jobId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update job: ${error.message}`);
      }

      return data;

    } catch (error) {
      console.error('Error updating job:', error);
      throw error;
    }
  }

  /**
   * Mark job as failed and increment attempts
   */
  static async markJobFailed(jobId, errorMessage, shouldRetry = true) {
    try {
      // First get current job data
      const { data: currentJob, error: fetchError } = await supabaseAdmin
        .from('jobs')
        .select('attempts, max_attempts')
        .eq('id', jobId)
        .single();

      if (fetchError) {
        throw new Error(`Failed to fetch job: ${fetchError.message}`);
      }

      const newAttempts = currentJob.attempts + 1;
      const canRetry = shouldRetry && newAttempts < currentJob.max_attempts;

      const updateData = {
        attempts: newAttempts,
        error_log: errorMessage,
        status: canRetry ? 'retry' : 'failed',
        completed_at: canRetry ? null : new Date(),
        updated_at: new Date()
      };

      // If retrying, schedule for later (exponential backoff)
      if (canRetry) {
        const delayMinutes = Math.pow(2, newAttempts - 1); // 1, 2, 4 minutes
        updateData.scheduled_at = new Date(Date.now() + delayMinutes * 60 * 1000);
      }

      const { data, error } = await supabaseAdmin
        .from('jobs')
        .update(updateData)
        .eq('id', jobId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to mark job as failed: ${error.message}`);
      }

      console.log(`❌ Job ${jobId} failed (attempt ${newAttempts}/${currentJob.max_attempts}). ${canRetry ? 'Will retry' : 'Max attempts reached'}`);
      return data;

    } catch (error) {
      console.error('Error marking job as failed:', error);
      throw error;
    }
  }

  /**
   * Get jobs for a specific session
   */
  static async getJobsForSession(sessionId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('jobs')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to get jobs for session: ${error.message}`);
      }

      return data;

    } catch (error) {
      console.error('Error getting jobs for session:', error);
      throw error;
    }
  }

  /**
   * Get job statistics
   */
  static async getJobStats() {
    try {
      const { data, error } = await supabaseAdmin
        .from('jobs')
        .select('status, type')
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) {
        throw new Error(`Failed to get job stats: ${error.message}`);
      }

      // Group by status and type
      const stats = data.reduce((acc, job) => {
        acc.byStatus[job.status] = (acc.byStatus[job.status] || 0) + 1;
        acc.byType[job.type] = (acc.byType[job.type] || 0) + 1;
        return acc;
      }, { byStatus: {}, byType: {} });

      return stats;

    } catch (error) {
      console.error('Error getting job stats:', error);
      throw error;
    }
  }
}

module.exports = JobService;
