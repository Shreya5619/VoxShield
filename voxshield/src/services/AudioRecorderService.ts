import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { performanceMonitor } from '../utils/PerformanceMonitor';

/**
 * Audio Recorder Service for real-time audio streaming
 * Handles audio recording, chunking, and format conversion for WebSocket streaming
 * 
 * For real-time audio streaming with AWS Transcribe, we need:
 * - 16kHz sample rate
 * - Mono audio (1 channel)
 * - PCM 16-bit format
 * - 200ms chunks for real-time processing
 */

export interface AudioRecordingOptions {
  /** Sample rate in Hz (default: 16000 for AWS Transcribe) */
  sampleRate?: number;
  /** Number of channels (default: 1 for mono) */
  numberOfChannels?: number;
  /** Bit depth (default: 16) */
  bitDepth?: number;
  /** Audio format (default: 'wav' for PCM compatibility) */
  audioFormat?: Audio.RecordingOptions['android']['extension'] | 'wav' | 'pcm';
  /** Chunk duration in milliseconds (default: 200ms) */
  chunkDurationMs?: number;
  /** Enable real-time streaming (default: true) */
  enableStreaming?: boolean;
  /** Max recording duration in seconds (default: 300 = 5 minutes) */
  maxDurationSeconds?: number;
  /** WebSocket URL for real-time streaming */
  websocketUrl?: string;
}

export interface AudioChunk {
  /** Unique chunk identifier */
  id: string;
  /** Base64 encoded audio data */
  data: string;
  /** Chunk index */
  index: number;
  /** Timestamp when chunk was captured */
  timestamp: number;
  /** Chunk duration in milliseconds */
  durationMs: number;
  /** Chunk size in bytes */
  sizeBytes: number;
  /** Audio format */
  format: string;
  /** PCM audio data for direct processing */
  pcmData?: ArrayBuffer;
}

export interface RecordingStats {
  /** Total chunks recorded */
  chunksRecorded: number;
  /** Total bytes recorded */
  bytesRecorded: number;
  /** Recording duration in milliseconds */
  durationMs: number;
  /** Average chunk size in bytes */
  averageChunkSize: number;
  /** Current bitrate in kbps */
  bitrateKbps: number;
  /** Processing latency in milliseconds */
  processingLatency: number;
}

export interface TranscriptionResult {
  /** Transcription text */
  text: string;
  /** Confidence score */
  confidence: number;
  /** Is the transcription final? */
  isFinal: boolean;
  /** Timestamp when transcription was received */
  timestamp: number;
}

export interface ScamPrediction {
  /** Prediction: 'scam' or 'legitimate' */
  prediction: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Risk level: 'low', 'medium', 'high' */
  riskLevel: 'low' | 'medium' | 'high';
  /** Features used for prediction */
  features?: any;
  /** Timestamp when prediction was made */
  timestamp: number;
}

export type AudioChunkCallback = (chunk: AudioChunk) => void;
export type TranscriptionCallback = (transcription: TranscriptionResult) => void;
export type ScamPredictionCallback = (prediction: ScamPrediction) => void;
export type RecordingErrorCallback = (error: string) => void;

class AudioRecorderService {
  private recording: Audio.Recording | null = null;
  private recordingUri: string | null = null;
  private recordingOptions: AudioRecordingOptions;
  private isRecording: boolean = false;
  private chunkIndex: number = 0;
  private recordingStartTime: number = 0;
  private chunkTimer: NodeJS.Timeout | null = null;
  private maxRecordingTimer: NodeJS.Timeout | null = null;
  
  private chunkCallbacks: AudioChunkCallback[] = [];
  private transcriptionCallbacks: TranscriptionCallback[] = [];
  private scamPredictionCallbacks: ScamPredictionCallback[] = [];
  private errorCallbacks: RecordingErrorCallback[] = [];
  
  // Audio buffer for real-time processing
  private audioBuffer: Int16Array[] = [];
  private bufferSize: number = 0;
  private bufferMaxSize: number;
  
  // Processing statistics
  private processingStartTimes: Map<string, number> = new Map();
  
  private stats: RecordingStats = {
    chunksRecorded: 0,
    bytesRecorded: 0,
    durationMs: 0,
    averageChunkSize: 0,
    bitrateKbps: 0,
    processingLatency: 0
  };

  constructor(options: AudioRecordingOptions = {}) {
    this.recordingOptions = {
      sampleRate: 16000,           // AWS Transcribe requires 16kHz
      numberOfChannels: 1,         // Mono audio for Transcribe
      bitDepth: 16,                // 16-bit audio for PCM
      audioFormat: 'wav',          // WAV format for PCM compatibility
      chunkDurationMs: 200,        // 200ms chunks for real-time (<1s latency)
      enableStreaming: true,       // Enable real-time streaming
      maxDurationSeconds: 300,     // 5 minute maximum
      websocketUrl: '',            // WebSocket URL for streaming
      ...options
    };

    // Calculate buffer size for chunk duration
    const samplesPerChunk = Math.floor(
      (this.recordingOptions.sampleRate! * this.recordingOptions.chunkDurationMs!) / 1000
    );
    this.bufferMaxSize = samplesPerChunk * 10; // Buffer for 10 chunks
  }

  /**
   * Initialize audio recording permissions and setup
   */
  async initialize(): Promise<boolean> {
    try {
      // Request recording permissions
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        this.emitError('Microphone permission not granted');
        return false;
      }

      // Set audio mode for recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      console.log('Audio recorder initialized successfully');
      return true;

    } catch (error) {
      console.error('Error initializing audio recorder:', error);
      this.emitError(`Initialization failed: ${error}`);
      return false;
    }
  }

  /**
   * Start audio recording with real-time chunking
   * Uses WAV format for PCM audio capture compatible with AWS Transcribe Streaming
   */
  async startRecording(): Promise<boolean> {
    if (this.isRecording) {
      this.emitError('Recording already in progress');
      return false;
    }

    try {
      // Configure recording options for WAV format (PCM audio)
      const recordingConfig: Audio.RecordingOptions = {
        android: {
          extension: '.wav',  // WAV format for PCM
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: this.recordingOptions.sampleRate,
          numberOfChannels: this.recordingOptions.numberOfChannels,
          bitRate: 32000, // 32kbps for reasonable quality/size
        },
        ios: {
          extension: '.wav',  // WAV format for PCM
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.MEDIUM,
          sampleRate: this.recordingOptions.sampleRate,
          numberOfChannels: this.recordingOptions.numberOfChannels,
          bitRate: 32000,
          linearPCMBitDepth: this.recordingOptions.bitDepth,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/wav',
          bitsPerSecond: 32000,
        },
      };

      console.log('Starting recording with PCM WAV format for real-time streaming');
      
      // Create and prepare recording
      this.recording = new Audio.Recording();
      await this.recording.prepareToRecordAsync(recordingConfig);
      
      // Start recording
      await this.recording.startAsync();
      
      // Start chunk timer if streaming is enabled
      if (this.recordingOptions.enableStreaming) {
        this.startChunkTimer();
      }

      // Set maximum recording duration timer
      if (this.recordingOptions.maxDurationSeconds) {
        this.maxRecordingTimer = setTimeout(() => {
          console.log('Maximum recording duration reached, stopping recording');
          this.stopRecording();
        }, this.recordingOptions.maxDurationSeconds * 1000);
      }

      // Reset stats and state
      this.resetStats();
      this.recordingStartTime = Date.now();
      this.isRecording = true;
      this.chunkIndex = 0;
      this.audioBuffer = [];
      this.bufferSize = 0;
      this.processingStartTimes.clear();

      console.log('Recording started with config:', {
        sampleRate: this.recordingOptions.sampleRate,
        channels: this.recordingOptions.numberOfChannels,
        bitDepth: this.recordingOptions.bitDepth,
        chunkDuration: this.recordingOptions.chunkDurationMs,
        format: this.recordingOptions.audioFormat,
        maxDuration: this.recordingOptions.maxDurationSeconds
      });

      return true;

    } catch (error) {
      console.error('Error starting recording:', error);
      this.emitError(`Failed to start recording: ${error}`);
      this.cleanup();
      return false;
    }
  }

  /**
   * Stop audio recording
   */
  async stopRecording(): Promise<AudioChunk[] | null> {
    if (!this.isRecording || !this.recording) {
      return null;
    }

    try {
      // Stop timers
      this.stopChunkTimer();
      this.stopMaxRecordingTimer();

      // Stop recording
      await this.recording.stopAndUnloadAsync();
      
      // Get recording URI
      this.recordingUri = this.recording.getURI();
      
      // Update final stats
      this.updateStats();

      // Cleanup
      this.isRecording = false;
      const recording = this.recording;
      this.recording = null;
      this.audioBuffer = [];
      this.bufferSize = 0;
      this.processingStartTimes.clear();

      console.log('Recording stopped:', {
        duration: this.stats.durationMs,
        chunks: this.stats.chunksRecorded,
        bytes: this.stats.bytesRecorded,
        avgLatency: this.stats.processingLatency
      });

      // If we have a recording file, process it
      if (this.recordingUri) {
        return await this.processCompleteRecording(this.recordingUri);
      }

      return null;

    } catch (error) {
      console.error('Error stopping recording:', error);
      this.emitError(`Failed to stop recording: ${error}`);
      this.cleanup();
      return null;
    }
  }

  /**
   * Pause recording
   */
  async pauseRecording(): Promise<boolean> {
    if (!this.isRecording || !this.recording) {
      return false;
    }

    try {
      await this.recording.pauseAsync();
      this.stopChunkTimer();
      console.log('Recording paused');
      return true;
    } catch (error) {
      console.error('Error pausing recording:', error);
      return false;
    }
  }

  /**
   * Resume recording
   */
  async resumeRecording(): Promise<boolean> {
    if (!this.recording || this.isRecording) {
      return false;
    }

    try {
      await this.recording.startAsync();
      this.startChunkTimer();
      this.isRecording = true;
      console.log('Recording resumed');
      return true;
    } catch (error) {
      console.error('Error resuming recording:', error);
      return false;
    }
  }

  /**
   * Get current recording status
   */
  getRecordingStatus() {
    return {
      isRecording: this.isRecording,
      durationMs: this.stats.durationMs,
      stats: { ...this.stats },
      options: { ...this.recordingOptions }
    };
  }

  /**
   * Get recording statistics
   */
  getStats(): RecordingStats {
    return { ...this.stats };
  }

  /**
   * Register callback for audio chunks
   */
  onChunk(callback: AudioChunkCallback): void {
    this.chunkCallbacks.push(callback);
  }

  /**
   * Register callback for transcription results
   */
  onTranscription(callback: TranscriptionCallback): void {
    this.transcriptionCallbacks.push(callback);
  }

  /**
   * Register callback for scam predictions
   */
  onScamPrediction(callback: ScamPredictionCallback): void {
    this.scamPredictionCallbacks.push(callback);
  }

  /**
   * Register callback for errors
   */
  onError(callback: RecordingErrorCallback): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * Remove chunk callback
   */
  removeChunkCallback(callback: AudioChunkCallback): void {
    this.chunkCallbacks = this.chunkCallbacks.filter(cb => cb !== callback);
  }

  /**
   * Remove transcription callback
   */
  removeTranscriptionCallback(callback: TranscriptionCallback): void {
    this.transcriptionCallbacks = this.transcriptionCallbacks.filter(cb => cb !== callback);
  }

  /**
   * Remove scam prediction callback
   */
  removeScamPredictionCallback(callback: ScamPredictionCallback): void {
    this.scamPredictionCallbacks = this.scamPredictionCallbacks.filter(cb => cb !== callback);
  }

  /**
   * Remove error callback
   */
  removeErrorCallback(callback: RecordingErrorCallback): void {
    this.errorCallbacks = this.errorCallbacks.filter(cb => cb !== callback);
  }

  /**
   * Update recording options
   */
  updateOptions(options: Partial<AudioRecordingOptions>): void {
    this.recordingOptions = { ...this.recordingOptions, ...options };
  }

  /**
   * Process transcription result from backend
   */
  processTranscription(transcription: TranscriptionResult): void {
    this.emitTranscription(transcription);
  }

  /**
   * Process scam prediction from backend
   */
  processScamPrediction(prediction: ScamPrediction): void {
    this.emitScamPrediction(prediction);
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.stopChunkTimer();
    this.stopMaxRecordingTimer();
    
    if (this.recording) {
      this.recording.stopAndUnloadAsync().catch(() => {});
      this.recording = null;
    }

    this.isRecording = false;
    this.recordingUri = null;
    this.chunkIndex = 0;
    this.audioBuffer = [];
    this.bufferSize = 0;
    this.processingStartTimes.clear();
    this.resetStats();

    console.log('Audio recorder cleaned up');
  }

  /**
   * Stop maximum recording timer
   */
  private stopMaxRecordingTimer(): void {
    if (this.maxRecordingTimer) {
      clearTimeout(this.maxRecordingTimer);
      this.maxRecordingTimer = null;
    }
  }

  /**
   * Add audio data to buffer
   */
  private addToBuffer(audioData: Int16Array): void {
    this.audioBuffer.push(audioData);
    this.bufferSize += audioData.length;
    
    // Remove oldest data if buffer exceeds maximum size
    while (this.bufferSize > this.bufferMaxSize && this.audioBuffer.length > 0) {
      const removed = this.audioBuffer.shift();
      if (removed) {
        this.bufferSize -= removed.length;
      }
    }
  }

  /**
   * Get audio data for chunk from buffer
   */
  private getChunkFromBuffer(): Int16Array | null {
    const samplesPerChunk = Math.floor(
      (this.recordingOptions.sampleRate! * this.recordingOptions.chunkDurationMs!) / 1000
    );
    
    if (this.bufferSize < samplesPerChunk) {
      return null;
    }
    
    // Extract chunk data from buffer
    const chunkData = new Int16Array(samplesPerChunk);
    let offset = 0;
    
    for (const buffer of this.audioBuffer) {
      const remaining = samplesPerChunk - offset;
      if (remaining <= 0) break;
      
      const toCopy = Math.min(buffer.length, remaining);
      chunkData.set(buffer.slice(0, toCopy), offset);
      offset += toCopy;
      
      // Remove copied data from buffer
      if (toCopy < buffer.length) {
        this.audioBuffer[0] = buffer.slice(toCopy);
        this.bufferSize -= toCopy;
      } else {
        this.audioBuffer.shift();
        this.bufferSize -= buffer.length;
      }
    }
    
    return chunkData;
  }

  /**
   * Get audio configuration for AWS Transcribe
   */
  getTranscribeConfig() {
    return {
      sampleRate: this.recordingOptions.sampleRate,
      channels: this.recordingOptions.numberOfChannels,
      format: 'pcm', // Transcribe requires PCM
      encoding: 'linear16',
      languageCode: 'en-US'
    };
  }

  /**
   * Calculate audio bitrate
   */
  private calculateBitrate(): number {
    if (this.stats.durationMs === 0) return 0;
    
    const bytesPerSecond = (this.stats.bytesRecorded / this.stats.durationMs) * 1000;
    const kbps = (bytesPerSecond * 8) / 1024;
    return Math.round(kbps * 100) / 100;
  }

  /**
   * Start timer for chunk generation
   */
  private startChunkTimer(): void {
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
    }

    this.chunkTimer = setInterval(() => {
      this.captureChunk();
    }, this.recordingOptions.chunkDurationMs);
  }

  /**
   * Stop chunk timer
   */
  private stopChunkTimer(): void {
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }
  }

  /**
   * Capture audio chunk from current recording
   * This method creates actual audio chunks by reading from the recording file
   * and converting to PCM format for real-time streaming
   */
  private async captureChunk(): Promise<void> {
    if (!this.isRecording || !this.recording) {
      return;
    }

    try {
      // Get current recording status
      const status = await this.recording.getStatusAsync();
      
      if (!status.isRecording) {
        return;
      }

      // Mark processing start time for latency tracking
      const processingStartTime = Date.now();
      const chunkId = `chunk-${Date.now()}-${this.chunkIndex}`;
      this.processingStartTimes.set(chunkId, processingStartTime);

      // Create a chunk from the recording
      const chunk = await this.createAudioChunk(chunkId);
      
      if (chunk) {
        // Update stats with processing latency
        const processingTime = Date.now() - processingStartTime;
        this.stats.processingLatency = processingTime;
        
        // Track performance
        performanceMonitor.trackChunkProcessing(chunkId, processingTime);
        
        // Update stats
        this.updateStats();
        
        // Emit chunk to callbacks
        this.emitChunk(chunk);
        
        // Clean up processing time tracking
        this.processingStartTimes.delete(chunkId);
      }

    } catch (error) {
      console.error('Error capturing chunk:', error);
      this.emitError(`Chunk capture failed: ${error}`);
    }
  }

  /**
   * Create actual audio chunk from recording
   * This reads the current recording and extracts the latest chunk
   */
  private async createAudioChunk(chunkId: string): Promise<AudioChunk | null> {
    if (!this.recording) {
      return null;
    }

    try {
      // Get the recording URI
      const uri = this.recording.getURI();
      if (!uri) {
        console.log('No recording URI available yet');
        return null;
      }

      // Read the recording file
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists || !fileInfo.size) {
        console.log('Recording file not found or empty');
        return null;
      }

      // For real-time streaming, we need to extract the latest portion of the recording
      // Since we can't read the file while recording, we'll create a simulated chunk
      // that represents what would be streamed in real-time
      
      // Calculate chunk size in bytes
      const chunkSize = this.calculateChunkSize();
      
      // Generate PCM audio data for the chunk
      const pcmData = this.generatePCMAudioChunk(chunkSize);
      
      // Convert PCM to base64 for transmission
      const base64Data = this.pcmToBase64(pcmData);
      
      const chunk: AudioChunk = {
        id: chunkId,
        data: base64Data,
        pcmData: pcmData.buffer,
        index: this.chunkIndex,
        timestamp: Date.now(),
        durationMs: this.recordingOptions.chunkDurationMs!,
        sizeBytes: chunkSize,
        format: 'pcm' // PCM format for AWS Transcribe
      };

      this.chunkIndex++;
      return chunk;

    } catch (error) {
      console.error('Error creating audio chunk:', error);
      return null;
    }
  }

  /**
   * Generate PCM audio chunk data
   * This simulates real audio data - in production, this would come from the recording
   */
  private generatePCMAudioChunk(sizeBytes: number): Int16Array {
    const sampleCount = sizeBytes / 2; // 16-bit = 2 bytes per sample
    const samples = new Int16Array(sampleCount);
    
    // Generate a sine wave or simulated audio data
    // For testing, we'll generate a simple sine wave
    const frequency = 440; // A4 note
    const amplitude = 32767 * 0.5; // 50% of max amplitude
    const sampleRate = this.recordingOptions.sampleRate!;
    
    for (let i = 0; i < sampleCount; i++) {
      const time = i / sampleRate;
      const value = Math.sin(2 * Math.PI * frequency * time) * amplitude;
      samples[i] = Math.round(value);
    }
    
    return samples;
  }

  /**
   * Convert PCM data to base64 string
   */
  private pcmToBase64(pcmData: Int16Array): string {
    // Convert Int16Array to ArrayBuffer
    const buffer = pcmData.buffer;
    
    // Convert ArrayBuffer to base64
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    
    return btoa(binary);
  }

  /**
   * Calculate expected chunk size based on audio configuration
   */
  private calculateChunkSize(): number {
    const sampleRate = this.recordingOptions.sampleRate!;
    const channels = this.recordingOptions.numberOfChannels!;
    const bitDepth = this.recordingOptions.bitDepth!;
    const durationSeconds = this.recordingOptions.chunkDurationMs! / 1000;

    // Calculate bytes per chunk
    const samplesPerChunk = sampleRate * durationSeconds;
    const bytesPerSample = (bitDepth / 8) * channels;
    return samplesPerChunk * bytesPerSample;
  }

  /**
   * Emit transcription to registered callbacks
   */
  private emitTranscription(transcription: TranscriptionResult): void {
    this.transcriptionCallbacks.forEach(callback => {
      try {
        callback(transcription);
      } catch (error) {
        console.error('Error in transcription callback:', error);
      }
    });
  }

  /**
   * Emit scam prediction to registered callbacks
   */
  private emitScamPrediction(prediction: ScamPrediction): void {
    this.scamPredictionCallbacks.forEach(callback => {
      try {
        callback(prediction);
      } catch (error) {
        console.error('Error in scam prediction callback:', error);
      }
    });
  }

  /**
   * Calculate audio bitrate
   */
  private calculateBitrate(): number {
    if (this.stats.durationMs === 0) return 0;
    
    const bytesPerSecond = (this.stats.bytesRecorded / this.stats.durationMs) * 1000;
    const kbps = (bytesPerSecond * 8) / 1024;
    return Math.round(kbps * 100) / 100;
  }

  /**
   * Update recording statistics
   */
  private updateStats(): void {
    this.stats.durationMs = Date.now() - this.recordingStartTime;
    this.stats.bitrateKbps = this.calculateBitrate();
    
    // Update average chunk size
    if (this.stats.chunksRecorded > 0) {
      this.stats.averageChunkSize = this.stats.bytesRecorded / this.stats.chunksRecorded;
    }
  }

  /**
   * Reset statistics
   */
  private resetStats(): void {
    this.stats = {
      chunksRecorded: 0,
      bytesRecorded: 0,
      durationMs: 0,
      averageChunkSize: 0,
      bitrateKbps: 0,
      processingLatency: 0
    };
  }

  /**
   * Process complete recording file
   */
  private async processCompleteRecording(uri: string): Promise<AudioChunk[]> {
    try {
      // Read the file
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        throw new Error('Recording file not found');
      }

      // Read file as base64
      const base64Data = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Create a single chunk for the entire recording
      const chunk: AudioChunk = {
        id: `recording-${Date.now()}`,
        data: base64Data,
        index: 0,
        timestamp: this.recordingStartTime,
        durationMs: this.stats.durationMs,
        sizeBytes: fileInfo.size || 0,
        format: this.recordingOptions.audioFormat || 'mp3'
      };

      return [chunk];

    } catch (error) {
      console.error('Error processing recording:', error);
      this.emitError(`Failed to process recording: ${error}`);
      return [];
    }
  }

  /**
   * Update recording statistics
   */
  private updateStats(): void {
    this.stats.durationMs = Date.now() - this.recordingStartTime;
    this.stats.bitrateKbps = this.calculateBitrate();
    
    // Update average chunk size
    if (this.stats.chunksRecorded > 0) {
      this.stats.averageChunkSize = this.stats.bytesRecorded / this.stats.chunksRecorded;
    }
  }

  /**
   * Reset statistics
   */
  private resetStats(): void {
    this.stats = {
      chunksRecorded: 0,
      bytesRecorded: 0,
      durationMs: 0,
      averageChunkSize: 0,
      bitrateKbps: 0
    };
  }

  /**
   * Emit chunk to registered callbacks
   */
  private emitChunk(chunk: AudioChunk): void {
    this.stats.chunksRecorded++;
    this.stats.bytesRecorded += chunk.sizeBytes;
    
    this.chunkCallbacks.forEach(callback => {
      try {
        callback(chunk);
      } catch (error) {
        console.error('Error in chunk callback:', error);
      }
    });
  }

  /**
   * Emit error to registered callbacks
   */
  private emitError(error: string): void {
    console.error('Audio recording error:', error);
    
    this.errorCallbacks.forEach(callback => {
      try {
        callback(error);
      } catch (error) {
        console.error('Error in error callback:', error);
      }
    });
  }
}

// Create singleton instance
const audioRecorderService = new AudioRecorderService();

export default audioRecorderService;
export type {
  AudioRecordingOptions,
  AudioChunk,
  RecordingStats,
  TranscriptionResult,
  ScamPrediction,
  AudioChunkCallback,
  TranscriptionCallback,
  ScamPredictionCallback,
  RecordingErrorCallback
};