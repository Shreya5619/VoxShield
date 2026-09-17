/**
 * Performance Monitor
 * Tracks app performance metrics and provides optimization recommendations
 */

export interface PerformanceMetric {
  /** Metric name */
  name: string;
  /** Current value */
  value: number;
  /** Unit of measurement */
  unit: string;
  /** Timestamp when measured */
  timestamp: number;
  /** Performance status: 'good', 'warning', 'critical' */
  status: 'good' | 'warning' | 'critical';
}

export interface PerformanceReport {
  /** Report timestamp */
  timestamp: number;
  /** Overall performance score (0-100) */
  score: number;
  /** Performance metrics */
  metrics: PerformanceMetric[];
  /** Optimization recommendations */
  recommendations: string[];
  /** Performance issues detected */
  issues: string[];
}

export class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric> = new Map();
  private memoryUsage: { used: number; total: number } = { used: 0, total: 0 };
  private frameTimes: number[] = [];
  private lastFrameTime: number = 0;
  private maxFrameTimeHistory = 60; // Keep last 60 frames

  /**
   * Track WebSocket connection time
   */
  trackWebSocketConnection(startTime: number, endTime: number): void {
    const connectionTime = endTime - startTime;
    const metric: PerformanceMetric = {
      name: 'websocket_connection_time',
      value: connectionTime,
      unit: 'ms',
      timestamp: Date.now(),
      status: connectionTime < 2000 ? 'good' : connectionTime < 5000 ? 'warning' : 'critical'
    };
    this.metrics.set(metric.name, metric);
  }

  /**
   * Track audio chunk processing time
   */
  trackChunkProcessing(chunkId: string, processingTime: number): void {
    const metric: PerformanceMetric = {
      name: `chunk_processing_${chunkId}`,
      value: processingTime,
      unit: 'ms',
      timestamp: Date.now(),
      status: processingTime < 50 ? 'good' : processingTime < 100 ? 'warning' : 'critical'
    };
    this.metrics.set(metric.name, metric);

    // Update average chunk processing time
    this.updateAverageMetric('avg_chunk_processing', processingTime);
  }

  /**
   * Track WebSocket message processing time
   */
  trackMessageProcessing(messageType: string, processingTime: number): void {
    const metric: PerformanceMetric = {
      name: `message_processing_${messageType}`,
      value: processingTime,
      unit: 'ms',
      timestamp: Date.now(),
      status: processingTime < 20 ? 'good' : processingTime < 50 ? 'warning' : 'critical'
    };
    this.metrics.set(metric.name, metric);
  }

  /**
   * Track UI rendering frame time
   */
  trackFrameRender(): void {
    const now = Date.now();
    
    if (this.lastFrameTime > 0) {
      const frameTime = now - this.lastFrameTime;
      this.frameTimes.push(frameTime);
      
      // Keep only recent frame times
      if (this.frameTimes.length > this.maxFrameTimeHistory) {
        this.frameTimes.shift();
      }

      // Update frame time metrics
      const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      const fps = 1000 / avgFrameTime;
      
      const metric: PerformanceMetric = {
        name: 'fps',
        value: fps,
        unit: 'fps',
        timestamp: now,
        status: fps > 50 ? 'good' : fps > 30 ? 'warning' : 'critical'
      };
      this.metrics.set(metric.name, metric);
    }
    
    this.lastFrameTime = now;
  }

  /**
   * Track memory usage (simulated for React Native)
   */
  trackMemoryUsage(): void {
    // In a real app, you would use React Native's Performance API
    // For simulation, we'll track approximate usage
    
    const usedMB = Math.random() * 100 + 50; // Simulated 50-150 MB usage
    const totalMB = 512; // Simulated total memory
    
    this.memoryUsage = { used: usedMB, total: totalMB };
    
    const usagePercentage = (usedMB / totalMB) * 100;
    const metric: PerformanceMetric = {
      name: 'memory_usage',
      value: usagePercentage,
      unit: '%',
      timestamp: Date.now(),
      status: usagePercentage < 60 ? 'good' : usagePercentage < 80 ? 'warning' : 'critical'
    };
    this.metrics.set(metric.name, metric);
  }

  /**
   * Track network request performance
   */
  trackNetworkRequest(url: string, duration: number, success: boolean): void {
    const metric: PerformanceMetric = {
      name: `network_request_${url.replace(/[^a-zA-Z0-9]/g, '_')}`,
      value: duration,
      unit: 'ms',
      timestamp: Date.now(),
      status: success ? (duration < 500 ? 'good' : duration < 1000 ? 'warning' : 'critical') : 'critical'
    };
    this.metrics.set(metric.name, metric);
  }

  /**
   * Update average metric
   */
  private updateAverageMetric(metricName: string, newValue: number): void {
    const existing = this.metrics.get(metricName);
    
    if (existing) {
      // Simple moving average
      existing.value = (existing.value * 0.9) + (newValue * 0.1);
      existing.timestamp = Date.now();
      
      // Update status based on new average
      if (metricName.includes('chunk_processing')) {
        existing.status = existing.value < 50 ? 'good' : existing.value < 100 ? 'warning' : 'critical';
      }
      
      this.metrics.set(metricName, existing);
    } else {
      const metric: PerformanceMetric = {
        name: metricName,
        value: newValue,
        unit: 'ms',
        timestamp: Date.now(),
        status: newValue < 50 ? 'good' : newValue < 100 ? 'warning' : 'critical'
      };
      this.metrics.set(metricName, metric);
    }
  }

  /**
   * Get performance report
   */
  getPerformanceReport(): PerformanceReport {
    const metrics = Array.from(this.metrics.values());
    const now = Date.now();
    
    // Calculate overall score (0-100)
    let score = 100;
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Analyze metrics
    metrics.forEach(metric => {
      if (metric.status === 'critical') {
        score -= 15;
        issues.push(`${metric.name} is critical: ${metric.value}${metric.unit}`);
      } else if (metric.status === 'warning') {
        score -= 5;
        issues.push(`${metric.name} is warning: ${metric.value}${metric.unit}`);
      }
    });

    // Cap score
    score = Math.max(0, Math.min(100, score));

    // Generate recommendations based on issues
    if (issues.some(issue => issue.includes('websocket_connection_time'))) {
      recommendations.push('Optimize WebSocket connection - consider implementing connection pooling');
    }
    
    if (issues.some(issue => issue.includes('chunk_processing'))) {
      recommendations.push('Reduce audio chunk size or optimize chunk processing');
    }
    
    if (issues.some(issue => issue.includes('fps'))) {
      recommendations.push('Optimize UI rendering - consider using React.memo for components');
      recommendations.push('Reduce state updates frequency');
    }
    
    if (issues.some(issue => issue.includes('memory_usage'))) {
      recommendations.push('Implement memory cleanup for audio buffers');
      recommendations.push('Consider pagination for transcription history');
    }

    // Add general recommendations
    if (score < 70) {
      recommendations.push('Consider implementing code splitting for better initial load');
      recommendations.push('Use React Native Performance Monitor for detailed profiling');
    }

    return {
      timestamp: now,
      score,
      metrics,
      recommendations,
      issues
    };
  }

  /**
   * Get specific metric
   */
  getMetric(name: string): PerformanceMetric | undefined {
    return this.metrics.get(name);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): PerformanceMetric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    this.frameTimes = [];
    this.lastFrameTime = 0;
  }

  /**
   * Start performance monitoring
   */
  startMonitoring(): void {
    // Start frame tracking
    const trackFrame = () => {
      this.trackFrameRender();
      requestAnimationFrame(trackFrame);
    };
    trackFrame();

    // Start memory tracking (simulated)
    setInterval(() => {
      this.trackMemoryUsage();
    }, 5000); // Every 5 seconds
  }

  /**
   * Get optimization tips
   */
  static getOptimizationTips(): string[] {
    return [
      '✅ Use React.memo() for expensive components',
      '✅ Implement useCallback for event handlers',
      '✅ Use useMemo for expensive calculations',
      '✅ Batch state updates to reduce re-renders',
      '✅ Optimize image sizes and use caching',
      '✅ Implement lazy loading for non-critical components',
      '✅ Use FlatList virtualized rendering for long lists',
      '✅ Minimize use of inline styles',
      '✅ Implement connection pooling for WebSocket',
      '✅ Use chunked audio streaming with optimal buffer sizes',
      '✅ Implement proper error boundaries',
      '✅ Use React Native Performance API for profiling',
      '✅ Consider code splitting with React.lazy',
      '✅ Optimize bundle size with tree shaking',
      '✅ Implement proper cleanup in useEffect'
    ];
  }
}

// Create singleton instance
export const performanceMonitor = new PerformanceMonitor();