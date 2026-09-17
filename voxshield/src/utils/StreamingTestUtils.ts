/**
 * Streaming Test Utilities
 * Tools for testing and validating real-time audio streaming performance
 */

import { AudioChunk, TranscriptionResult, ScamPrediction } from '../services/AudioRecorderService';

export interface LatencyMeasurement {
  /** Chunk ID */
  chunkId: string;
  /** Time when chunk was generated (ms) */
  generationTime: number;
  /** Time when chunk was sent via WebSocket (ms) */
  sendTime: number;
  /** Time when transcription was received (ms) */
  transcriptionTime: number;
  /** Time when prediction was received (ms) */
  predictionTime: number;
  /** Processing latency (ms) */
  processingLatency: number;
  /** End-to-end latency (ms) */
  endToEndLatency: number;
}

export interface PerformanceStats {
  /** Average processing latency (ms) */
  avgProcessingLatency: number;
  /** Average end-to-end latency (ms) */
  avgEndToEndLatency: number;
  /** Maximum processing latency (ms) */
  maxProcessingLatency: number;
  /** Maximum end-to-end latency (ms) */
  maxEndToEndLatency: number;
  /** Latency standard deviation (ms) */
  latencyStdDev: number;
  /** Number of chunks processed */
  chunksProcessed: number;
  /** Successful chunk transmission rate (%) */
  transmissionSuccessRate: number;
  /** Average chunk size (bytes) */
  avgChunkSize: number;
  /** Total data transferred (bytes) */
  totalDataTransferred: number;
}

export class StreamingTestController {
  private latencyMeasurements: Map<string, LatencyMeasurement> = new Map();
  private chunkTimestamps: Map<string, number> = new Map();
  private performanceStats: PerformanceStats = {
    avgProcessingLatency: 0,
    avgEndToEndLatency: 0,
    maxProcessingLatency: 0,
    maxEndToEndLatency: 0,
    latencyStdDev: 0,
    chunksProcessed: 0,
    transmissionSuccessRate: 0,
    avgChunkSize: 0,
    totalDataTransferred: 0
  };

  private totalProcessingLatency = 0;
  private totalEndToEndLatency = 0;
  private totalChunkSize = 0;
  private successfulTransmissions = 0;
  private totalTransmissions = 0;

  /**
   * Record chunk generation for latency measurement
   */
  recordChunkGeneration(chunk: AudioChunk): void {
    const measurement: LatencyMeasurement = {
      chunkId: chunk.id,
      generationTime: chunk.timestamp,
      sendTime: 0,
      transcriptionTime: 0,
      predictionTime: 0,
      processingLatency: 0,
      endToEndLatency: 0
    };

    this.latencyMeasurements.set(chunk.id, measurement);
    this.chunkTimestamps.set(chunk.id, chunk.timestamp);
  }

  /**
   * Record chunk transmission for latency measurement
   */
  recordChunkTransmission(chunkId: string, success: boolean): void {
    const measurement = this.latencyMeasurements.get(chunkId);
    if (measurement) {
      measurement.sendTime = Date.now();
      this.latencyMeasurements.set(chunkId, measurement);
    }

    this.totalTransmissions++;
    if (success) {
      this.successfulTransmissions++;
    }
  }

  /**
   * Record transcription receipt for latency measurement
   */
  recordTranscription(transcription: TranscriptionResult, chunkId: string): void {
    const measurement = this.latencyMeasurements.get(chunkId);
    if (measurement) {
      measurement.transcriptionTime = transcription.timestamp;
      this.calculateLatency(chunkId);
    }
  }

  /**
   * Record prediction receipt for latency measurement
   */
  recordPrediction(prediction: ScamPrediction, chunkId: string): void {
    const measurement = this.latencyMeasurements.get(chunkId);
    if (measurement) {
      measurement.predictionTime = prediction.timestamp;
      this.calculateLatency(chunkId);
    }
  }

  /**
   * Calculate latency for a chunk
   */
  private calculateLatency(chunkId: string): void {
    const measurement = this.latencyMeasurements.get(chunkId);
    if (!measurement || !measurement.transcriptionTime || !measurement.predictionTime) {
      return;
    }

    // Processing latency: time from send to transcription
    measurement.processingLatency = measurement.transcriptionTime - measurement.sendTime;
    
    // End-to-end latency: time from generation to prediction
    measurement.endToEndLatency = measurement.predictionTime - measurement.generationTime;

    // Update totals
    this.totalProcessingLatency += measurement.processingLatency;
    this.totalEndToEndLatency += measurement.endToEndLatency;
    this.chunksProcessed++;

    // Update performance stats
    this.updatePerformanceStats();
  }

  /**
   * Update performance statistics
   */
  private updatePerformanceStats(): void {
    if (this.chunksProcessed === 0) return;

    this.performanceStats.avgProcessingLatency = this.totalProcessingLatency / this.chunksProcessed;
    this.performanceStats.avgEndToEndLatency = this.totalEndToEndLatency / this.chunksProcessed;
    this.performanceStats.chunksProcessed = this.chunksProcessed;
    
    if (this.totalTransmissions > 0) {
      this.performanceStats.transmissionSuccessRate = 
        (this.successfulTransmissions / this.totalTransmissions) * 100;
    }

    if (this.chunksProcessed > 0) {
      this.performanceStats.avgChunkSize = this.totalChunkSize / this.chunksProcessed;
    }

    // Calculate max latencies
    let maxProcessing = 0;
    let maxEndToEnd = 0;
    let latencySumSquares = 0;

    this.latencyMeasurements.forEach(measurement => {
      if (measurement.processingLatency > maxProcessing) {
        maxProcessing = measurement.processingLatency;
      }
      if (measurement.endToEndLatency > maxEndToEnd) {
        maxEndToEnd = measurement.endToEndLatency;
      }
      
      // For standard deviation calculation
      latencySumSquares += Math.pow(measurement.processingLatency - this.performanceStats.avgProcessingLatency, 2);
    });

    this.performanceStats.maxProcessingLatency = maxProcessing;
    this.performanceStats.maxEndToEndLatency = maxEndToEnd;
    
    // Calculate standard deviation
    if (this.chunksProcessed > 1) {
      this.performanceStats.latencyStdDev = Math.sqrt(latencySumSquares / (this.chunksProcessed - 1));
    }
  }

  /**
   * Record chunk size for statistics
   */
  recordChunkSize(chunk: AudioChunk): void {
    this.totalChunkSize += chunk.sizeBytes;
    this.performanceStats.totalDataTransferred += chunk.sizeBytes;
  }

  /**
   * Get current performance statistics
   */
  getPerformanceStats(): PerformanceStats {
    return { ...this.performanceStats };
  }

  /**
   * Get latency measurements for specific chunk
   */
  getChunkLatency(chunkId: string): LatencyMeasurement | undefined {
    return this.latencyMeasurements.get(chunkId);
  }

  /**
   * Get all latency measurements
   */
  getAllLatencyMeasurements(): LatencyMeasurement[] {
    return Array.from(this.latencyMeasurements.values());
  }

  /**
   * Reset all measurements
   */
  reset(): void {
    this.latencyMeasurements.clear();
    this.chunkTimestamps.clear();
    this.performanceStats = {
      avgProcessingLatency: 0,
      avgEndToEndLatency: 0,
      maxProcessingLatency: 0,
      maxEndToEndLatency: 0,
      latencyStdDev: 0,
      chunksProcessed: 0,
      transmissionSuccessRate: 0,
      avgChunkSize: 0,
      totalDataTransferred: 0
    };
    this.totalProcessingLatency = 0;
    this.totalEndToEndLatency = 0;
    this.totalChunkSize = 0;
    this.successfulTransmissions = 0;
    this.totalTransmissions = 0;
  }

  /**
   * Generate latency report
   */
  generateReport(): string {
    const stats = this.getPerformanceStats();
    
    let report = '���� STREAMING PERFORMANCE REPORT 📊\n\n';
    report += `Chunks Processed: ${stats.chunksProcessed}\n`;
    report += `Total Data: ${(stats.totalDataTransferred / 1024).toFixed(2)} KB\n\n`;
    
    report += `⚡ LATENCY METRICS ⚡\n`;
    report += `Average Processing Latency: ${stats.avgProcessingLatency.toFixed(2)} ms\n`;
    report += `Average End-to-End Latency: ${stats.avgEndToEndLatency.toFixed(2)} ms\n`;
    report += `Maximum Processing Latency: ${stats.maxProcessingLatency.toFixed(2)} ms\n`;
    report += `Maximum End-to-End Latency: ${stats.maxEndToEndLatency.toFixed(2)} ms\n`;
    report += `Latency Standard Deviation: ${stats.latencyStdDev.toFixed(2)} ms\n\n`;
    
    report += `📈 TRANSMISSION METRICS 📈\n`;
    report += `Transmission Success Rate: ${stats.transmissionSuccessRate.toFixed(2)}%\n`;
    report += `Average Chunk Size: ${stats.avgChunkSize.toFixed(2)} bytes\n`;
    
    // Check if latency meets <1 second requirement
    const meetsRequirement = stats.avgEndToEndLatency < 1000;
    report += `\n🎯 REQUIREMENT CHECK 🎯\n`;
    report += `<1 Second Latency Requirement: ${meetsRequirement ? '✅ MET' : '❌ NOT MET'}\n`;
    report += `Current Average: ${stats.avgEndToEndLatency.toFixed(2)} ms\n`;
    
    return report;
  }

  /**
   * Simulate backend processing with configurable latency
   */
  static simulateBackendProcessing(chunk: AudioChunk, options: {
    minLatency?: number;
    maxLatency?: number;
    successRate?: number;
  } = {}): Promise<{transcription: TranscriptionResult, prediction: ScamPrediction}> {
    const {
      minLatency = 300,
      maxLatency = 800,
      successRate = 0.95
    } = options;

    return new Promise((resolve, reject) => {
      // Simulate random success/failure
      if (Math.random() > successRate) {
        reject(new Error('Simulated backend processing failure'));
        return;
      }

      // Simulate processing latency
      const processingTime = minLatency + Math.random() * (maxLatency - minLatency);
      
      setTimeout(() => {
        const transcription: TranscriptionResult = {
          text: `Simulated transcription for chunk ${chunk.index}: "This is a test phrase for scam detection"`,
          confidence: 0.85 + Math.random() * 0.15, // 85-100% confidence
          isFinal: Math.random() > 0.7, // 30% chance of being final
          timestamp: Date.now()
        };

        const prediction: ScamPrediction = {
          prediction: Math.random() > 0.7 ? 'scam' : 'legitimate', // 30% chance of scam
          confidence: 0.6 + Math.random() * 0.4, // 60-100% confidence
          riskLevel: Math.random() > 0.8 ? 'high' : 
                    Math.random() > 0.5 ? 'medium' : 'low',
          features: { chunkSize: chunk.sizeBytes, duration: chunk.durationMs },
          timestamp: Date.now()
        };

        resolve({ transcription, prediction });
      }, processingTime);
    });
  }
}

// Create singleton instance
export const streamingTestController = new StreamingTestController();