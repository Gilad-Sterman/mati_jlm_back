const { supabase, supabaseAdmin } = require('../config/database');
const crypto = require('crypto');
const axios = require('axios');

class PasswordResetService {
  /**
   * Generate a secure random token for password reset
   */
  static generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a password reset token for a user
   */
  static async createResetToken(email) {
    try {
      const client = supabaseAdmin || supabase;

      // Find user by email
      const { data: user, error: userError } = await client
        .from('users')
        .select('id, email, name, status')
        .eq('email', email.toLowerCase())
        .single();

      if (userError || !user) {
        // Don't reveal if email exists or not for security
        return {
          success: true,
          message: 'If an account with that email exists, you will receive a password reset email.'
        };
      }

      // Check if user is active
      if (user.status !== 'active') {
        return {
          success: true,
          message: 'If an account with that email exists, you will receive a password reset email.'
        };
      }

      // Generate secure token
      const token = this.generateResetToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Clean up any existing unused tokens for this user
      await client
        .from('password_reset_tokens')
        .delete()
        .eq('user_id', user.id)
        .is('used_at', null);

      // Create new reset token
      const { error: tokenError } = await client
        .from('password_reset_tokens')
        .insert({
          user_id: user.id,
          token,
          expires_at: expiresAt.toISOString()
        });

      if (tokenError) {
        throw new Error('Failed to create reset token');
      }

      // Log token for development (remove in production)
      console.log('🔑 Password Reset Token Generated:');
      console.log(`📧 Email: ${user.email}`);
      console.log(`🎫 Token: ${token}`);
      console.log(`⏰ Expires: ${expiresAt.toISOString()}`);
      console.log(`🔗 Reset URL: ${process.env.FRONTEND_URL || 'http://localhost:5000'}/reset-password?token=${token}`);

      // Send email via Make.com webhook
      await this.sendResetEmail(user, token);

      return {
        success: true,
        message: 'If an account with that email exists, you will receive a password reset email.'
      };

    } catch (error) {
      console.error('Password reset token creation failed:', error);
      throw new Error('Failed to process password reset request');
    }
  }

  /**
   * Send password reset email via Make.com webhook
   */
  static async sendResetEmail(user, token) {
    try {
      const makeWebhookUrl = process.env.MAKE_PASSWORD_RESET_WEBHOOK_URL;
      const makeApiKey = process.env.MAKE_PASSWORD_RESET_API_KEY;
      
      if (!makeWebhookUrl || !makeApiKey) {
        console.warn('⚠️ Make.com webhook URL or API key not configured. Email not sent.');
        return;
      }

      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/reset-password?token=${token}`;
      
      const payload = {
        email: user.email,
        name: user.name,
        resetUrl,
        token, // Include token for Make.com to use in email template
        expiresIn: '1 hour'
      };

      console.log('📤 Sending password reset email via Make.com:', {
        email: user.email,
        resetUrl
      });

      const response = await axios.post(makeWebhookUrl, payload, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'x-make-apikey': makeApiKey
        }
      });

      console.log('✅ Password reset email sent successfully');
      return response.data;

    } catch (error) {
      console.error('❌ Failed to send password reset email:', error.message);
      // Don't throw error - we don't want to reveal email sending failures to user
    }
  }

  /**
   * Validate a reset token
   */
  static async validateResetToken(token) {
    try {
      const client = supabaseAdmin || supabase;

      const { data: resetToken, error } = await client
        .from('password_reset_tokens')
        .select(`
          id,
          user_id,
          expires_at,
          used_at,
          users!inner (
            id,
            email,
            name,
            status
          )
        `)
        .eq('token', token)
        .single();

      if (error || !resetToken) {
        throw new Error('Invalid or expired reset token');
      }

      // Check if token is already used
      if (resetToken.used_at) {
        throw new Error('Reset token has already been used');
      }

      // Check if token is expired
      if (new Date() > new Date(resetToken.expires_at)) {
        throw new Error('Reset token has expired');
      }

      // Check if user is still active
      if (resetToken.users.status !== 'active') {
        throw new Error('User account is not active');
      }

      return {
        isValid: true,
        userId: resetToken.user_id,
        user: resetToken.users
      };

    } catch (error) {
      return {
        isValid: false,
        error: error.message
      };
    }
  }

  /**
   * Reset password using token
   */
  static async resetPassword(token, newPassword) {
    try {
      const client = supabaseAdmin || supabase;

      // Validate token first
      const validation = await this.validateResetToken(token);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      // Hash the new password
      const AuthService = require('./authService');
      const passwordHash = await AuthService.hashPassword(newPassword);

      // Update user password
      const { error: updateError } = await client
        .from('users')
        .update({ password_hash: passwordHash })
        .eq('id', validation.userId);

      if (updateError) {
        throw new Error('Failed to update password');
      }

      // Mark token as used
      await client
        .from('password_reset_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('token', token);

      console.log('✅ Password reset successful for user:', validation.user.email);

      return {
        success: true,
        message: 'Password has been reset successfully'
      };

    } catch (error) {
      console.error('Password reset failed:', error);
      throw new Error(error.message || 'Failed to reset password');
    }
  }

  /**
   * Clean up expired tokens (maintenance function)
   */
  static async cleanupExpiredTokens() {
    try {
      const client = supabaseAdmin || supabase;

      const { data, error } = await client
        .from('password_reset_tokens')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select('id');

      if (error) {
        throw error;
      }

      console.log(`🧹 Cleaned up ${data?.length || 0} expired password reset tokens`);
      return data?.length || 0;

    } catch (error) {
      console.error('Failed to cleanup expired tokens:', error);
      return 0;
    }
  }
}

module.exports = PasswordResetService;
