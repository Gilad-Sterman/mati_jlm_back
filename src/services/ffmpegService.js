const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class FFmpegService {
  /**
   * Concatenate multiple audio/video files into a single file
   */
  static async concatenateFiles(filePaths, outputFileName = null) {
    if (!filePaths || filePaths.length === 0) {
      throw new Error('No files provided for concatenation');
    }

    if (filePaths.length === 1) {
      // If only one file, just return it as-is
      return {
        success: true,
        outputPath: filePaths[0],
        originalFiles: filePaths,
        concatenated: false
      };
    }

    try {
      // Create temporary directory for processing
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-concat-'));
      
      // Generate output filename
      const timestamp = Date.now();
      const outputPath = path.join(tempDir, outputFileName || `concatenated_${timestamp}.mp3`);
      
      // Create file list for FFmpeg concat demuxer
      const fileListPath = path.join(tempDir, 'filelist.txt');
      const fileListContent = filePaths
        .map(filePath => `file '${filePath.replace(/'/g, "'\"'\"'")}'`) // Escape single quotes
        .join('\n');
      
      fs.writeFileSync(fileListPath, fileListContent);
      
      console.log(`🔗 Concatenating ${filePaths.length} files using FFmpeg...`);
      console.log(`📝 File list: ${fileListContent.replace(/\n/g, ', ')}`);
      
      // FFmpeg command to concatenate files
      const ffmpegArgs = [
        '-f', 'concat',           // Use concat demuxer
        '-safe', '0',             // Allow unsafe file paths
        '-i', fileListPath,       // Input file list
        '-c', 'copy',             // Copy streams without re-encoding (faster)
        '-y',                     // Overwrite output file
        outputPath
      ];
      
      // If files have different formats or output is MP3, use re-encoding instead
      const needsReencoding = await this.checkIfReencodingNeeded(filePaths, outputPath);
      if (needsReencoding) {
        console.log('📦 Re-encoding to MP3 for compatibility...');
        // Replace '-c', 'copy' with MP3 encoding
        const copyIndex = ffmpegArgs.indexOf('copy');
        ffmpegArgs.splice(copyIndex - 1, 2, '-c:a', 'mp3', '-b:a', '64k');
      }
      
      const result = await this.runFFmpegCommand(ffmpegArgs);
      
      if (!result.success) {
        throw new Error(`FFmpeg concatenation failed: ${result.error}`);
      }
      
      // Verify output file exists and has content
      if (!fs.existsSync(outputPath)) {
        throw new Error('Concatenated file was not created');
      }
      
      const outputStats = fs.statSync(outputPath);
      if (outputStats.size === 0) {
        throw new Error('Concatenated file is empty');
      }
      
      const outputSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
      console.log(`✅ Concatenation complete: ${outputSizeMB}MB output file`);
      
      // Clean up file list
      try {
        fs.unlinkSync(fileListPath);
      } catch (cleanupError) {
        console.warn('Failed to clean up file list:', cleanupError.message);
      }
      
      return {
        success: true,
        outputPath: outputPath,
        originalFiles: filePaths,
        concatenated: true,
        outputSize: outputStats.size,
        tempDir: tempDir // Return temp dir for cleanup later
      };
      
    } catch (error) {
      console.error('❌ FFmpeg concatenation error:', error);
      throw error;
    }
  }
  
  /**
   * Check if files need re-encoding (different formats/codecs)
   */
  static async checkIfReencodingNeeded(filePaths, outputPath) {
    // Always re-encode if output is MP3 (ensures codec compatibility)
    if (outputPath && outputPath.endsWith('.mp3')) {
      return true;
    }
    
    // Also check for mixed input formats
    const extensions = filePaths.map(filePath => path.extname(filePath).toLowerCase());
    const uniqueExtensions = [...new Set(extensions)];
    
    return uniqueExtensions.length > 1;
  }
  
  /**
   * Run FFmpeg command with promise wrapper
   */
  static runFFmpegCommand(args) {
    return new Promise((resolve, reject) => {
      console.log(`🎬 Running FFmpeg: ffmpeg ${args.join(' ')}`);
      
      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';
      
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          console.error('❌ FFmpeg stderr:', stderr);
          resolve({ 
            success: false, 
            error: `FFmpeg exited with code ${code}. Error: ${stderr}` 
          });
        }
      });
      
      ffmpeg.on('error', (error) => {
        console.error('❌ FFmpeg spawn error:', error);
        resolve({ 
          success: false, 
          error: `Failed to spawn FFmpeg: ${error.message}` 
        });
      });
    });
  }
  
  /**
   * Clean up temporary files and directories
   */
  static cleanupTempFiles(tempDir, filePaths = []) {
    try {
      // Clean up individual files
      filePaths.forEach(filePath => {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          console.warn(`Failed to clean up file ${filePath}:`, error.message);
        }
      });
      
      // Clean up temp directory
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn('Failed to clean up temp files:', error.message);
    }
  }
}

module.exports = FFmpegService;
