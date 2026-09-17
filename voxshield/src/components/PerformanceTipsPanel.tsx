/**
 * Performance Tips Panel Component
 * Shows performance optimization recommendations
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert
} from 'react-native';
import { PerformanceMonitor } from '../utils/PerformanceMonitor';

interface PerformanceTipsPanelProps {
  /** Whether the panel is visible */
  visible: boolean;
  /** Performance report data */
  performanceReport?: any;
  /** Callback when panel is closed */
  onClose: () => void;
}

const PerformanceTipsPanel: React.FC<PerformanceTipsPanelProps> = ({
  visible,
  performanceReport,
  onClose
}) => {
  if (!visible) return null;

  const optimizationTips = PerformanceMonitor.getOptimizationTips();
  
  // Filter tips based on performance issues
  const getRelevantTips = () => {
    if (!performanceReport) return optimizationTips;
    
    const relevantTips: string[] = [];
    const issues = performanceReport.issues || [];
    
    issues.forEach((issue: string) => {
      if (issue.includes('websocket_connection_time')) {
        relevantTips.push('✅ Implement connection pooling for WebSocket');
        relevantTips.push('✅ Use WebSocket keep-alive to maintain connections');
      }
      
      if (issue.includes('chunk_processing')) {
        relevantTips.push('✅ Reduce audio chunk size from 200ms to 150ms');
        relevantTips.push('✅ Implement chunk batching for better throughput');
      }
      
      if (issue.includes('fps') || issue.includes('memory_usage')) {
        relevantTips.push('✅ Use React.memo() for expensive components');
        relevantTips.push('✅ Implement useCallback for event handlers');
        relevantTips.push('✅ Use useMemo for expensive calculations');
        relevantTips.push('✅ Batch state updates to reduce re-renders');
      }
    });
    
    // Add general tips if no specific issues
    if (relevantTips.length === 0) {
      return optimizationTips.slice(0, 8); // Show first 8 general tips
    }
    
    // Remove duplicates and return
    return [...new Set([...relevantTips, ...optimizationTips.slice(0, 3)])];
  };

  const tips = getRelevantTips();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Performance Optimization Tips</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Performance Summary */}
        {performanceReport && (
          <View style={styles.summarySection}>
            <Text style={styles.summaryTitle}>Performance Summary</Text>
            <View style={styles.scoreContainer}>
              <View style={styles.scoreCircle}>
                <Text style={styles.scoreText}>{performanceReport.score}</Text>
                <Text style={styles.scoreLabel}>SCORE</Text>
              </View>
              <View style={styles.scoreDetails}>
                <Text style={styles.scoreDetailText}>
                  Issues: {performanceReport.issues?.length || 0}
                </Text>
                <Text style={styles.scoreDetailText}>
                  Recommendations: {performanceReport.recommendations?.length || 0}
                </Text>
              </View>
            </View>
            
            {/* Performance Issues */}
            {performanceReport.issues && performanceReport.issues.length > 0 && (
              <View style={styles.issuesContainer}>
                <Text style={styles.issuesTitle}>⚠️ Performance Issues Detected:</Text>
                {performanceReport.issues.map((issue: string, index: number) => (
                  <Text key={index} style={styles.issueText}>• {issue}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Optimization Tips */}
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>
            🎯 Recommended Optimizations ({tips.length})
          </Text>
          
          {tips.map((tip, index) => (
            <View key={index} style={styles.tipItem}>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>

        {/* Quick Actions */}
        <View style={styles.actionsSection}>
          <Text style={styles.actionsTitle}>🚀 Quick Performance Actions</Text>
          
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              Alert.alert('Clear Cache', 'This will clear all cached data and buffers.');
              // In a real app, you would implement cache clearing logic
            }}
          >
            <Text style={styles.actionButtonText}>🗑️ Clear Audio Buffers</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              Alert.alert('Optimize Settings', 'Adjusting streaming parameters for better performance.');
              // In a real app, you would adjust streaming settings
            }}
          >
            <Text style={styles.actionButtonText}>⚙️ Optimize Streaming Settings</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              Alert.alert('Memory Cleanup', 'Performing memory cleanup and garbage collection.');
              // In a real app, you would trigger memory cleanup
            }}
          >
            <Text style={styles.actionButtonText}>🧹 Run Memory Cleanup</Text>
          </TouchableOpacity>
        </View>

        {/* Performance Metrics */}
        {performanceReport && performanceReport.metrics && (
          <View style={styles.metricsSection}>
            <Text style={styles.metricsTitle}>📊 Current Metrics</Text>
            
            <View style={styles.metricsGrid}>
              {performanceReport.metrics.slice(0, 6).map((metric: any, index: number) => (
                <View key={index} style={styles.metricItem}>
                  <Text style={styles.metricName}>{metric.name.replace(/_/g, ' ')}</Text>
                  <Text style={[
                    styles.metricValue,
                    metric.status === 'critical' ? styles.metricCritical :
                    metric.status === 'warning' ? styles.metricWarning :
                    styles.metricGood
                  ]}>
                    {metric.value.toFixed(1)}{metric.unit}
                  </Text>
                  <View style={[
                    styles.metricStatus,
                    metric.status === 'critical' ? styles.statusCritical :
                    metric.status === 'warning' ? styles.statusWarning :
                    styles.statusGood
                  ]}>
                    <Text style={styles.metricStatusText}>
                      {metric.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
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
  summarySection: {
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
  summaryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  scoreCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  scoreText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  scoreLabel: {
    fontSize: 10,
    color: '#fff',
    opacity: 0.9,
    marginTop: 2,
  },
  scoreDetails: {
    flex: 1,
  },
  scoreDetailText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  issuesContainer: {
    backgroundColor: '#fff3cd',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffeaa7',
  },
  issuesTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#856404',
    marginBottom: 8,
  },
  issueText: {
    fontSize: 11,
    color: '#856404',
    marginBottom: 4,
  },
  tipsSection: {
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
  tipsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  tipItem: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#4CD964',
  },
  tipText: {
    fontSize: 12,
    color: '#333',
    lineHeight: 18,
  },
  actionsSection: {
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
  actionsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  actionButton: {
    backgroundColor: '#6c757d',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  metricsSection: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  metricsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  metricName: {
    fontSize: 10,
    color: '#666',
    marginBottom: 4,
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  metricGood: {
    color: '#4CD964',
  },
  metricWarning: {
    color: '#FF9500',
  },
  metricCritical: {
    color: '#FF3B30',
  },
  metricStatus: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusGood: {
    backgroundColor: '#e6f4ea',
  },
  statusWarning: {
    backgroundColor: '#fff3cd',
  },
  statusCritical: {
    backgroundColor: '#f8d7da',
  },
  metricStatusText: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#333',
  },
});

export default PerformanceTipsPanel;