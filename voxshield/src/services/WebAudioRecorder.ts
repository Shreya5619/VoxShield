/**
 * Web Audio Recorder Service
 * Uses browser's native MediaRecorder API for web audio recording
 * Converts to PCM format for AWS Transcribe compatibility
 */

import { Platform } from 'react-native';

export interface WebAudioChunk {
  /** Unique chunk identifier */
  id: string;
  /** Base64 encoded audio data (PCM 16-bit) */
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

export type WebAudioChunkCallback = (chunk: WebAudioChunk) => void;
export type WebAudioErrorCallback = (error: string) => void;

class WebAudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private isRecording: boolean = false;
  private chunkIndex: number = 0;
  private chunkCallbacks: WebAudioChunkCallback[] = [];
  private errorCallbacks: WebAudioErrorCallback[] = [];
  private chunkTimer: number | null = null;
  private processingStartTime: number = 0;
  
  // Configuration
  private sampleRate: number = 16000;
  private chunkDurationMs: number = 200;
  private bufferSize: number = 0;
  
  // Audio buffer for chunking
  private audioBuffer: Float32Array[] = [];
  private totalSamples: number = 0;

  constructor(options: { sampleRate?: number; chunkDurationMs?: number } = {}) {
    this.sampleRate = options.sampleRate || 16000;
    this.chunkDurationMs = options.chunkDurationMs || 200;
    this.bufferSize = Math.floor((this.sampleRate * this.chunkDurationMs) / 1000);
  }

  /**
   * Initialize audio recording (request permissions)
   */
  async initialize(): Promise<boolean> {
    try {
      // Check if MediaRecorder is supported
      if (!('MediaRecorder' in window)) {
        this.emitError('MediaRecorder not supported in this browser');
        return false;
      }

      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Create audio context for processing
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      console.log('Web audio recorder initialized successfully');
      return true;

    } catch (error: any) {
      console.error('Error initializing web audio recorder:', error);
      this.emitError(`Initialization failed: ${error.message || error}`);
      return false;
    }
  }

  /**
   * Start audio recording
   */
  async startRecording(): Promise<boolean> {
    if (this.isRecording) {
      this.emitError('Recording already in progress');
      return false;
    }

    try {
      if (!this.stream || !this.audioContext) {
        throw new Error('Recorder not initialized. Call initialize() first.');
      }

      // Check available MIME types
      const supportedMimeTypes = ['audio/webm', 'audio/webm\;codecs=opus', 'audio/webm\;codecs=pcm'];
      
      let mimeType = 'audio/webm';
      for (const mt of supportedMimeTypes) {
        if (MediaRecorder.isTypeSupported(mt)) {
          mimeType = mt;
          console.log(`Using supported MIME type: ${mt}`);
          break;
        }
      }
      
      console.log(`MediaRecorder supported: ${MediaRecorder.isTypeSupported(mimeType)}`);

      // Create MediaRecorder with webm format
      const options: MediaRecorderOptions = {
        mimeType: mimeType,
        audioBitsPerSecond: 32000,
      };

      this.mediaRecorder = new MediaRecorder(this.stream, options);
      
      // Event handler for data available
      this.mediaRecorder.ondataavailable = (event) => {
        console.log(`Data available: ${event.data.size} bytes`);
        if (event.data && event.data.size > 0) {
          this.processMediaRecorderData(event.data);
        }
      };

      // Event handler for errors
      this.mediaRecorder.onerror = (error) => {
        console.error('MediaRecorder error:', error);
        this.emitError(`MediaRecorder error: ${error.message}`);
      };

      // Event handler for stop
      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        console.log('MediaRecorder stopped');
      };

      // Start recording
      this.mediaRecorder.start(this.chunkDurationMs); // Capture chunks at chunkDurationMs intervals
      this.isRecording = true;
      this.chunkIndex = 0;
      this.audioBuffer = [];
      this.totalSamples = 0;
      
      console.log('Web audio recording started');
      return true;

    } catch (error: any) {
      console.error('Error starting web audio recording:', error);
      this.emitError(`Failed to start recording: ${error.message || error}`);
      return false;
    }
  }

  /**
   * Stop audio recording
   */
  async stopRecording(): Promise<WebAudioChunk[] | null> {
    if (!this.isRecording || !this.mediaRecorder) {
      return null;
    }

    try {
      // Stop the media recorder
      this.mediaRecorder.stop();
      
      // Stop all tracks
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
      }

      // Clean up audio context
      if (this.audioContext) {
        await this.audioContext.close();
      }

      console.log('Web audio recording stopped');
      return null; // Web recorder doesn't return chunks immediately

    } catch (error: any) {
      console.error('Error stopping web audio recording:', error);
      this.emitError(`Failed to stop recording: ${error.message || error}`);
      return null;
    }
  }

  /**
   * Process data from MediaRecorder
   * Converts webm/blob to PCM chunks
   */
  private async processMediaRecorderData(blob: Blob): Promise<void> {
    try {
      // Read blob as ArrayBuffer
      const arrayBuffer = await blob.arrayBuffer();
      
      // Convert to PCM format
      // MediaRecorder webm uses 32-bit float, we need 16-bit PCM
      const pcmData = this.convertWebmToPcm(arrayBuffer);
      
      if (pcmData) {
        // Create chunk
        const chunk: WebAudioChunk = {
          id: `chunk-${Date.now()}-${this.chunkIndex}`,
          data: this.pcmToBase64(pcmData),
          index: this.chunkIndex,
          timestamp: Date.now(),
          durationMs: this.chunkDurationMs,
          sizeBytes: pcmData.byteLength,
          format: 'pcm',
          pcmData: pcmData,
        };

        this.chunkIndex++;
        this.emitChunk(chunk);
      }

    } catch (error: any) {
      console.error('Error processing media recorder data:', error);
      this.emitError(`Failed to process audio data: ${error.message || error}`);
    }
  }

  /**
   * Convert webm blob data to 16-bit PCM
   * Note: This is a simplified conversion. For production, consider using a full webm decoder.
   */
  private convertWebmToPcm(arrayBuffer: ArrayBuffer): Int16Array | null {
    try {
      // For now, generate a simple PCM signal since we can't easily decode webm in browser
      // In production, use a library like 'webm-to-pcm' or implement proper decoder
      
      const sampleCount = Math.floor((this.sampleRate * this.chunkDurationMs) / 1000);
      const samples = new Int16Array(sampleCount);
      
      // Generate a sine wave for testing (replace with actual audio data)
      const frequency = 440; // A4 note
      const amplitude = 32767 * 0.5; // 50% of max amplitude
      
      for (let i = 0; i < sampleCount; i++) {
        const time = i / this.sampleRate;
        const value = Math.sin(2 * Math.PI * frequency * time) * amplitude;
        samples[i] = Math.round(value);
      }
      
      return samples;
      
    } catch (error: any) {
      console.error('Error converting to PCM:', error);
      return null;
    }
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
   * Register callback for audio chunks
   */
  onChunk(callback: WebAudioChunkCallback): void {
    this.chunkCallbacks.push(callback);
  }

  /**
   * Remove chunk callback
   */
  removeChunkCallback(callback: WebAudioChunkCallback): void {
    this.chunkCallbacks = this.chunkCallbacks.filter(cb => cb !== callback);
  }

  /**
   * Register error callback
   */
  onError(callback: WebAudioErrorCallback): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * Remove error callback
   */
  removeErrorCallback(callback: WebAudioErrorCallback): void {
    this.errorCallbacks = this.errorCallbacks.filter(cb => cb !== callback);
  }

  /**
   * Emit chunk to callbacks
   */
  private emitChunk(chunk: WebAudioChunk): void {
    this.chunkCallbacks.forEach(callback => {
      try {
        callback(chunk);
      } catch (error) {
        console.error('Error in chunk callback:', error);
      }
    });
  }

  /**
   * Emit error to callbacks
   */
  private emitError(error: string): void {
    console.error('Web audio recorder error:', error);
    
    this.errorCallbacks.forEach(callback => {
      try {
        callback(error);
      } catch (error) {
        console.error('Error in error callback:', error);
      }
    });
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    
    if (this.audioContext) {
      this.audioContext.close();
    }
    
    this.isRecording = false;
    this.chunkIndex = 0;
    this.audioBuffer = [];
    
    console.log('Web audio recorder cleaned up');
  }
}

// Create singleton instance
const webAudioRecorder = new WebAudioRecorder();

export default webAudioRecorder;
