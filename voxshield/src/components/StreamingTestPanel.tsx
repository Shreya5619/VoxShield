/**
 * Streaming Test Panel Component
 * UI for testing and validating real-time audio streaming performance
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch
} from 'react-native';
import { streamingTestController, PerformanceStats } from '../utils/StreamingTestUtils';
import audioRecorderService, { AudioChunk } from '../services/AudioRecorderService';

interface StreamingTestPanelProps {
  /** Whether the panel is visible */
  visible: boolean;
  /** Callback when panel is closed */
  onClose: () => void;
}

const StreamingTestPanel: React.FC<StreamingTestPanelProps> = ({ visible, onClose }) => {
  const [isTesting, setIsTesting] = useState(false);
  const [testDuration, setTestDuration] = useState(30); // seconds
  const [testResults, setTestResults] = useState<PerformanceStats | null>(null);
  const [chunksGenerated, setChunksGenerated] = useState(0);
  const [simulateBackend, setSimulateBackend] = useState(true);
  const [testProgress, setTestProgress] = useState(0);
  const [realTimeStats, setRealTimeStats] = useState<PerformanceStats | null>(null);

  // Test configuration
  const testConfig = {
    chunkDurationMs: 200,
    targetLatencyMs: 1000,
    minBackendLatency: 300,
    maxBackendLatency: 800,
    backendSuccessRate: 0.95
  };

  // Update real-time stats periodically
  useEffect(() => {
    if (!isTesting) return;

    const interval = setInterval(() => {
      const stats = streamingTestController.getPerformanceStats();
      setRealTimeStats(stats);
    }, 1000);

    return () => clearInterval(interval);
  }, [isTesting]);

  // Simulate audio chunk generation for testing
  const simulateChunkGeneration = useCallback(async () => {
    const chunk: AudioChunk = {
      id: `test-chunk-${Date.now()}-${chunksGenerated}`,
      data: 'test-base64-audio-data',
      index: chunksGenerated,
      timestamp: Date.now(),
      durationMs: testConfig.chunkDurationMs,
      sizeBytes: 3200, // Simulated 200ms of 16kHz mono 16-bit PCM
      format: 'pcm'
    };

    // Record chunk generation for latency measurement
    streamingTestController.recordChunkGeneration(chunk);
    streamingTestController.recordChunkSize(chunk);

    setChunksGenerated(prev => prev + 1);

    // Simulate WebSocket transmission with random success
    const transmissionSuccess = Math.random() > 0.05; // 95% success rate
    streamingTestController.recordChunkTransmission(chunk.id, transmissionSuccess);

    if (transmissionSuccess && simulateBackend) {
      try {
        // Simulate backend processing
        const result = await streamingTestController.simulateBackendProcessing(chunk, {
          minLatency: testConfig.minBackendLatency,
          maxLatency: testConfig.maxBackendLatency,
          successRate: testConfig.backendSuccessRate
        });

        // Record results
        streamingTestController.recordTranscription(result.transcription, chunk.id);
        streamingTestController.recordPrediction(result.prediction, chunk.id);

        // Update audio recorder service (simulating real responses)
        audioRecorderService.processTranscription(result.transcription);
        audioRecorderService.processScamPrediction(result.prediction);

      } catch (error) {
        console.error('Simulated backend processing failed:', error);
      }
    }

    return chunk;
  }, [chunksGenerated, simulateBackend, testConfig]);

  // Run streaming test
  const runStreamingTest = useCallback(async () => {
    if (isTesting) return;

    setIsTesting(true);
    setTestResults(null);
    setChunksGenerated(0);
    setTestProgress(0);
    streamingTestController.reset();

    const startTime = Date.now();
    const testDurationMs = testDuration * 1000;
    let elapsedTime = 0;

    console.log(`Starting streaming test for ${testDuration} seconds...`);

    while (elapsedTime < testDurationMs && isTesting) {
      // Generate chunk
      await simulateChunkGeneration();

      // Update progress
      elapsedTime = Date.now() - startTime;
      setTestProgress((elapsedTime / testDurationMs) * 100);

      // Wait for next chunk interval
      await new Promise(resolve => setTimeout(resolve, testConfig.chunkDurationMs));
    }

    // Test complete
    const finalStats = streamingTestController.getPerformanceStats();
    setTestResults(finalStats);
    setIsTesting(false);
    
    console.log('Streaming test complete:', finalStats);
    
    // Show summary
    Alert.alert(
      'Test Complete',
      streamingTestController.generateReport(),
      [{ text: 'OK', onPress: onClose }]
    );
  }, [isTesting, testDuration, testConfig, simulateChunkGeneration, onClose]);

  // Stop test
  const stopTest = useCallback(() => {
    setIsTesting(false);
    const stats = streamingTestController.getPerformanceStats();
    setTestResults(stats);
    
    Alert.alert(
      'Test Stopped',
      streamingTestController.generateReport(),
      [{ text: 'OK' }]
    );
  }, []);

  // Reset test
  const resetTest = useCallback(() => {
    setIsTesting(false);
    setTestResults(null);
    setChunksGenerated(0);
    setTestProgress(0);
    streamingTestController.reset();
  }, []);

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Streaming Performance Test</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Test Configuration */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Test Configuration</Text>
          
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Test Duration:</Text>
            <View style={styles.durationSelector}>
              {[15, 30, 60].map(duration => (
                <TouchableOpacity
                  key={duration}
                  style={[
                    styles.durationButton,
                    testDuration === duration && styles.durationButtonActive
                  ]}
                  onPress={() => setTestDuration(duration)}
                  disabled={isTesting}
                >
                  <Text style={[
                    styles.durationButtonText,
                    testDuration === duration && styles.durationButtonTextActive
                  ]}>
                    {duration}s
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Simulate Backend:</Text>
            <Switch
              value={simulateBackend}
              onValueChange={setSimulateBackend}
              disabled={isTesting}
            />
          </View>

          <View style={styles.configInfo}>
            <Text style={styles.configInfoText}>
              • Chunk Duration: {testConfig.chunkDurationMs}ms
            </Text>
            <Text style={styles.configInfoText}>
              • Target Latency: &lt;{testConfig.targetLatencyMs}ms
            </Text>
            {simulateBackend && (
              <Text style={styles.configInfoText}>
                • Backend Latency: {testConfig.minBackendLatency}-{testConfig.maxBackendLatency}ms
              </Text>
            )}
          </View>
        </View>

        {/* Test Controls */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Test Controls</Text>
          
          <View style={styles.buttonContainer}>
            {!isTesting ? (
              <TouchableOpacity
                style={styles.startButton}
                onPress={runStreamingTest}
              >
                <Text style={styles.startButtonText}>▶ Start Test</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.stopButton}
                onPress={stopTest}
              >
                <Text style={styles.stopButtonText}>⏹ Stop Test</Text>
              </TouchableOpacity>
            )}
            
            <TouchableOpacity
              style={styles.resetButton}
              onPress={resetTest}
              disabled={isTesting}
            >
              <Text style={styles.resetButtonText}>↺ Reset</Text>
            </TouchableOpacity>
          </View>

          {/* Test Progress */}
          {isTesting && (
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill, 
                    { width: `${testProgress}%` }
                  ]} 
                />
              </View>
              <Text style={styles.progressText}>
                {Math.round(testProgress)}% Complete
              </Text>
            </View>
          )}
        </View>

        {/* Real-time Stats */}
        {realTimeStats && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Real-time Statistics</Text>
            
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{realTimeStats.chunksProcessed}</Text>
                <Text style={styles.statLabel}>Chunks</Text>
              </View>
              
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {realTimeStats.avgEndToEndLatency.toFixed(0)}ms
                </Text>
                <Text style={styles.statLabel}>Avg Latency</Text>
              </View>
              
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {realTimeStats.transmissionSuccessRate.toFixed(1)}%
                </Text>
                <Text style={styles.statLabel}>Success Rate</Text>
              </View>
              
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {(realTimeStats.totalDataTransferred / 1024).toFixed(1)}KB
                </Text>
                <Text style={styles.statLabel}>Data Sent</Text>
              </View>
            </View>
          </View>
        )}

        {/* Test Results */}
        {testResults && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Test Results</Text>
            
            <View style={styles.resultsContainer}>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Chunks Processed:</Text>
                <Text style={styles.resultValue}>{testResults.chunksProcessed}</Text>
              </View>
              
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Avg E2E Latency:</Text>
                <Text style={styles.resultValue}>
                  {testResults.avgEndToEndLatency.toFixed(2)}ms
                  <Text style={[
                    styles.latencyStatus,
                    testResults.avgEndToEndLatency < testConfig.targetLatencyMs 
                      ? styles.latencyGood 
                      : styles.latencyPoor
                  ]}>
                    {testResults.avgEndToEndLatency < testConfig.targetLatencyMs 
                      ? ' ✅' 
                      : ' ❌'}
                  </Text>
                </Text>
              </View>
              
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Max E2E Latency:</Text>
                <Text style={styles.resultValue}>
                  {testResults.maxEndToEndLatency.toFixed(2)}ms
                </Text>
              </View>
              
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Success Rate:</Text>
                <Text style={styles.resultValue}>
                  {testResults.transmissionSuccessRate.toFixed(2)}%
                </Text>
              </View>
              
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Total Data:</Text>
                <Text style={styles.resultValue}>
                  {(testResults.totalDataTransferred / 1024).toFixed(2)} KB
                </Text>
              </View>
            </View>

            {/* Requirement Check */}
            <View style={styles.requirementCheck}>
              <Text style={styles.requirementTitle}>🎯 Requirement Check</Text>
              <Text style={styles.requirementText}>
                {testResults.avgEndToEndLatency < testConfig.targetLatencyMs 
                  ? '✅ Latency requirement MET (<1 second)'
                  : '❌ Latency requirement NOT MET (≥1 second)'}
              </Text>
              <Text style={styles.requirementDetail}>
                Average latency: {testResults.avgEndToEndLatency.toFixed(2)}ms / Target: {testConfig.targetLatencyMs}ms
              </Text>
            </View>
          </View>
        )}

        {/* Loading Indicator */}
        {isTesting && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>
              Testing in progress... {chunksGenerated} chunks generated
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    zIndex: 1000,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    backgroundColor: '#f8f9fa',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 20,
    color: '#666',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  configLabel: {
    fontSize: 14,
    color: '#666',
  },
  configInfo: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  configInfoText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  durationSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  durationButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  durationButtonActive: {
    backgroundColor: '#007AFF',
  },
  durationButtonText: {
    fontSize: 12,
    color: '#666',
    fontWeight: 'bold',
  },
  durationButtonTextActive: {
    color: '#fff',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  startButton: {
    flex: 1,
    backgroundColor: '#4CD964',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  stopButton: {
    flex: 1,
    backgroundColor: '#FF3B30',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  resetButton: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: 'bold',
  },
  progressContainer: {
    marginTop: 12,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
  },
  progressText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
  },
  resultsContainer: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  resultRowLast: {
    borderBottomWidth: 0,
  },
  resultLabel: {
    fontSize: 14,
    color: '#666',
  },
  resultValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  latencyStatus: {
    fontSize: 12,
  },
  latencyGood: {
    color: '#4CD964',
  },
  latencyPoor: {
    color: '#FF3B30',
  },
  requirementCheck: {
    backgroundColor: '#e6f4ea',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d4edda',
  },
  requirementTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#155724',
    marginBottom: 8,
  },
  requirementText: {
    fontSize: 12,
    color: '#155724',
    marginBottom: 4,
  },
  requirementDetail: {
    fontSize: 11,
    color: '#155724',
    opacity: 0.8,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
    marginTop: 12,
    textAlign: 'center',
  },
});

export default StreamingTestPanel;