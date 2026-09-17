import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { 
  StyleSheet, 
  Text, 
  View, 
  SafeAreaView, 
  TextInput, 
  TouchableOpacity,
  FlatList,
  Alert,
  ScrollView,
  Platform,
  PermissionsAndroid,
  ActivityIndicator
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import audioRecorderService, { 
  AudioChunk, 
  TranscriptionResult, 
  ScamPrediction 
} from './src/services/AudioRecorderService';
import { getWebSocketService, WebSocketService } from './src/services/WebSocketService';
import StreamingTestPanel from './src/components/StreamingTestPanel';
import PerformanceTipsPanel from './src/components/PerformanceTipsPanel';
import SkeletonLoader from './src/components/SkeletonLoader';
import { performanceMonitor } from './src/utils/PerformanceMonitor';
import { appConfig } from './src/config/appConfig';

type FamilyMember = {
  id: string;
  name: string;
  phoneNumber: string;
  relation: string;
  securityQuestion: string;
  securityAnswer: string;
};

type Tab = 'family' | 'home';

type StreamingSession = {
  sessionId: string;
  isActive: boolean;
  startTime: number;
  chunksSent: number;
  transcriptions: TranscriptionResult[];
  predictions: ScamPrediction[];
};

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('family');
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingType, setRecordingType] = useState<'family' | 'spammer' | null>(null);

  // Real-time streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [websocketStatus, setWebsocketStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [transcriptions, setTranscriptions] = useState<TranscriptionResult[]>([]);
  const [predictions, setPredictions] = useState<ScamPrediction[]>([]);
  const [latestPrediction, setLatestPrediction] = useState<ScamPrediction | null>(null);
  const [streamingStats, setStreamingStats] = useState({
    chunksSent: 0,
    bytesSent: 0,
    latencyMs: 0,
    connectionTime: 0
  });
  const [loading, setLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reconnectionAttempts, setReconnectionAttempts] = useState(0);
  const [isNetworkAvailable, setIsNetworkAvailable] = useState(true);

  // Form state
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [relation, setRelation] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');

  // Refs
  const websocketServiceRef = useRef<WebSocketService | null>(null);
  const streamingSessionRef = useRef<StreamingSession | null>(null);
  const failedChunksBufferRef = useRef<AudioChunk[]>([]);
  const connectionRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Test panel state
  const [showTestPanel, setShowTestPanel] = useState(false);
  
  // Performance monitoring state
  const [performanceStats, setPerformanceStats] = useState<any>(null);
  const [showPerformanceTips, setShowPerformanceTips] = useState(false);

  // WebSocket configuration
  const WEBSOCKET_URL = appConfig.websocketUrl;

  // Initialize WebSocket service
  const initializeWebSocket = useCallback(async () => {
    try {
      console.log('Initializing WebSocket service...');
      
      // Warn if using placeholder URL
      if (WEBSOCKET_URL.includes('your-api-gateway-url')) {
        console.warn('WebSocket URL is using placeholder. Update WEBSOCKET_URL in appConfig.ts with actual endpoint.');
      }
      
      const config = {
        serverUrl: WEBSOCKET_URL,
        connectionTimeout: 10000,
        reconnectDelay: 3000,
        maxReconnectAttempts: 5,
        autoReconnect: true,
        heartbeatInterval: 30000,
        queryParams: {
          clientType: 'mobile',
          userId: 'voxshield-user'
        }
      };

      websocketServiceRef.current = getWebSocketService(config);
      
      // Set up WebSocket event listeners
      websocketServiceRef.current.onConnectionStatus((status) => {
        setWebsocketStatus(status.status);
        console.log('WebSocket status changed:', status.status);
      });

      websocketServiceRef.current.onMessage((message) => {
        handleWebSocketMessage(message);
      });

      websocketServiceRef.current.onError((error) => {
        console.error('WebSocket error:', error);
        
        // Check if error is due to invalid URL
        if (error.includes('WebSocket error') || error.includes('error')) {
          Alert.alert(
            'WebSocket Connection Failed',
            'Unable to connect to WebSocket server. Please ensure:\n' +
            '1. The WebSocket URL is correctly configured in App.tsx\n' +
            '2. The WebSocket API Gateway is deployed and running\n' +
            '3. Network connection is available',
            [{ text: 'OK' }]
          );
        } else {
          Alert.alert('WebSocket Error', error);
        }
      });

      console.log('WebSocket service initialized');
      return true;

    } catch (error) {
      console.error('Failed to initialize WebSocket service:', error);
      Alert.alert('Initialization Error', 'Failed to setup WebSocket connection');
      return false;
    }
  }, []);

  // Retry buffered failed chunks when connection is restored
  const retryBufferedChunks = useCallback(async () => {
    if (failedChunksBufferRef.current.length === 0 || !websocketServiceRef.current?.isConnected()) {
      return;
    }

    console.log(`Retrying ${failedChunksBufferRef.current.length} buffered failed chunks...`);
    
    const chunksToRetry = [...failedChunksBufferRef.current];
    failedChunksBufferRef.current = []; // Clear buffer
    
    let successfulRetries = 0;
    
    for (const chunk of chunksToRetry) {
      try {
        // Inline retry logic for buffered chunks
        let retryCount = 0;
        let success = false;
        
        while (retryCount < 2 && isStreaming && !success) { // 2 retries for buffered chunks
          try {
            if (websocketServiceRef.current?.isConnected()) {
              success = websocketServiceRef.current.sendAudioChunk(
                chunk.id,
                chunk.data,
                {
                  index: chunk.index,
                  durationMs: chunk.durationMs,
                  format: chunk.format,
                  sampleRate: 16000,
                  channels: 1,
                  retryCount: retryCount + 1
                }
              );
            }
            
            if (success) {
              console.log(`Successfully resent buffered chunk ${chunk.id} after ${retryCount + 1} retries`);
              break;
            }
            
            retryCount++;
            if (retryCount < 2 && isStreaming) {
              await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
            }
          } catch (error) {
            console.error(`Error retrying buffered chunk ${chunk.id}:`, error);
            retryCount++;
          }
        }
        
        if (success) {
          successfulRetries++;
          setStreamingStats(prev => ({
            ...prev,
            chunksSent: prev.chunksSent + 1,
            bytesSent: prev.bytesSent + chunk.sizeBytes
          }));
        } else {
          // Put back in buffer for later retry
          failedChunksBufferRef.current.push(chunk);
        }
      } catch (error) {
        console.error('Error retrying buffered chunk:', error);
        failedChunksBufferRef.current.push(chunk);
      }
      
      // Small delay between retries to avoid overwhelming the connection
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`Retried ${successfulRetries}/${chunksToRetry.length} buffered chunks successfully`);
    
    if (failedChunksBufferRef.current.length > 0) {
      console.log(`${failedChunksBufferRef.current.length} chunks still pending retry`);
    }
  }, [isStreaming]);

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback((message: any) => {
    const processingStartTime = Date.now();
    
    try {
      console.log('Received WebSocket message:', message.type);

      switch (message.type) {
        case 'transcription_update':
          const transcription: TranscriptionResult = {
            text: message.data.text,
            confidence: message.data.confidence || 0.8,
            isFinal: message.data.isFinal || false,
            timestamp: Date.now()
          };
          
          setTranscriptions(prev => [...prev, transcription]);
          audioRecorderService.processTranscription(transcription);
          
          // Track message processing performance
          const processingTime = Date.now() - processingStartTime;
          performanceMonitor.trackMessageProcessing('transcription_update', processingTime);
          break;

        case 'scam_prediction':
          const prediction: ScamPrediction = {
            prediction: message.data.prediction || 'legitimate',
            confidence: message.data.confidence || 0.5,
            riskLevel: message.data.riskLevel || 'low',
            features: message.data.features,
            timestamp: Date.now()
          };
          
          setPredictions(prev => [...prev, prediction]);
          setLatestPrediction(prediction);
          audioRecorderService.processScamPrediction(prediction);
          
          // Track message processing performance
          const predictionProcessingTime = Date.now() - processingStartTime;
          performanceMonitor.trackMessageProcessing('scam_prediction', predictionProcessingTime);
          
          // Alert if high risk scam detected
          if (prediction.prediction === 'scam' && prediction.riskLevel === 'high') {
            Alert.alert('⚠️ High Risk Scam Detected!', 
              `Confidence: ${(prediction.confidence * 100).toFixed(1)}%`);
          }
          break;

        case 'connection_established':
          console.log('WebSocket connection established:', message.data);
          
          // Retry any buffered failed chunks when connection is restored
          if (failedChunksBufferRef.current.length > 0) {
            setTimeout(() => {
              retryBufferedChunks();
            }, 1000); // Wait a bit before retrying
          }
          break;

        case 'connection_error':
          console.error('Connection error from server:', message.data);
          setConnectionError(`Server error: ${message.data.message || 'Unknown error'}`);
          break;

        case 'server_busy':
          console.warn('Server busy, reducing chunk send rate:', message.data);
          // Could implement rate limiting here
          break;

        case 'chunk_acknowledged':
          // Server acknowledged receipt of a chunk
          if (message.data.chunkId) {
            console.log(`Chunk ${message.data.chunkId} acknowledged by server`);
          }
          break;

        case 'error':
          console.error('Server error:', message.data);
          setConnectionError(`Server error: ${message.data.message || 'Unknown error'}`);
          
          // Don't show alert for every error, only significant ones
          if (message.data.severity === 'high') {
            Alert.alert('Server Error', message.data.message || 'Unknown error');
          }
          break;

        case 'pong':
          // Heartbeat response
          break;

        default:
          console.log('Unknown message type:', message.type);
      }

    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      setConnectionError(`Message processing error: ${error}`);
    }
  }, [retryBufferedChunks]);

  // Check network connectivity
  const checkNetworkConnectivity = useCallback(async () => {
    try {
      // In a real app, you would use NetInfo or similar
      // For now, we'll simulate network check
      return isNetworkAvailable;
    } catch (error) {
      console.error('Error checking network connectivity:', error);
      return false;
    }
  }, [isNetworkAvailable]);

  // Connect to WebSocket server with enhanced error handling
  const connectWebSocket = useCallback(async () => {
    if (!websocketServiceRef.current) {
      const initialized = await initializeWebSocket();
      if (!initialized) {
        setConnectionError('Failed to initialize WebSocket service');
        return false;
      }
    }

    // Check network connectivity first
    const networkAvailable = await checkNetworkConnectivity();
    if (!networkAvailable) {
      setConnectionError('No network connection available');
      setWebsocketStatus('error');
      Alert.alert('Network Error', 'Please check your internet connection and try again');
      return false;
    }

    setLoading(true);
    setConnectionError(null);
    
    const connectionStartTime = Date.now();
    
    try {
      const connected = await websocketServiceRef.current!.connect();
      const connectionEndTime = Date.now();
      
      // Track connection performance
      performanceMonitor.trackWebSocketConnection(connectionStartTime, connectionEndTime);
      
      setLoading(false);
      
      if (connected) {
        console.log('WebSocket connected successfully');
        setReconnectionAttempts(0);
        setConnectionError(null);
        return true;
      } else {
        const attempts = reconnectionAttempts + 1;
        setReconnectionAttempts(attempts);
        
        if (attempts >= 3) {
          setConnectionError('Failed to connect after multiple attempts');
          Alert.alert(
            'Connection Failed', 
            'Unable to connect to server after multiple attempts. Please check your internet connection.'
          );
        } else {
          setConnectionError(`Connection attempt ${attempts} failed`);
          console.log(`WebSocket connection attempt ${attempts} failed`);
        }
        
        return false;
      }
    } catch (error) {
      setLoading(false);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error connecting to WebSocket:', error);
      setConnectionError(`Connection error: ${errorMessage}`);
      
      Alert.alert(
        'Connection Error', 
        `Failed to connect to server: ${errorMessage}`
      );
      return false;
    }
  }, [initializeWebSocket, checkNetworkConnectivity, reconnectionAttempts]);

  // Disconnect from WebSocket server
  const disconnectWebSocket = useCallback(() => {
    if (websocketServiceRef.current) {
      websocketServiceRef.current.disconnect();
      console.log('WebSocket disconnected');
    }
    setWebsocketStatus('disconnected');
    setIsStreaming(false);
  }, []);

  // Handle WebSocket connection loss during streaming
  const handleConnectionLoss = useCallback(async () => {
    if (isStreaming && recording) {
      console.log('Connection lost during streaming, attempting to reconnect...');
      
      // Show connection loss alert
      Alert.alert(
        'Connection Lost',
        'Lost connection to server. Attempting to reconnect...',
        [{ text: 'OK' }]
      );

      // Attempt reconnection
      let reconnected = false;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts && !reconnected) {
        attempts++;
        console.log(`Reconnection attempt ${attempts}/${maxAttempts}`);
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
        
        // Check if still streaming and recording
        if (isStreaming && recording) {
          reconnected = await connectWebSocket();
          
          if (reconnected && streamingSessionRef.current) {
            // Resume streaming with same session
            websocketServiceRef.current?.startStreaming(
              streamingSessionRef.current.sessionId,
              {
                callerType: recordingType,
                sampleRate: 16000,
                channels: 1,
                format: 'pcm',
                isResume: true
              }
            );
            console.log('Successfully reconnected and resumed streaming');
          }
        } else {
          break; // Stop reconnection attempts if streaming stopped
        }
      }

      if (!reconnected && isStreaming) {
        // Final failure
        Alert.alert(
          'Reconnection Failed',
          'Unable to reconnect to server. Recording will continue locally.',
          [
            { 
              text: 'Continue Locally', 
              onPress: () => console.log('Continuing recording locally') 
            },
            { 
              text: 'Stop Recording', 
              style: 'destructive',
              onPress: stopRecording
            }
          ]
        );
      }
    }
  }, [isStreaming, recording, recordingType, connectWebSocket]);

  // Start performance monitoring on mount
  useEffect(() => {
    performanceMonitor.startMonitoring();
    
    // Update performance stats periodically
    const interval = setInterval(() => {
      const report = performanceMonitor.getPerformanceReport();
      setPerformanceStats(report);
    }, 5000); // Update every 5 seconds
    
    return () => clearInterval(interval);
  }, []);

  // Setup audio recorder callbacks
  useEffect(() => {
    // Set up audio chunk callback for streaming
    audioRecorderService.onChunk(async (chunk: AudioChunk) => {
      if (isStreaming && websocketServiceRef.current?.isConnected()) {
        // Send audio chunk via WebSocket
        const success = websocketServiceRef.current.sendAudioChunk(
          chunk.id,
          chunk.data,
          {
            index: chunk.index,
            durationMs: chunk.durationMs,
            format: chunk.format,
            sampleRate: 16000,
            channels: 1
          }
        );

        if (success) {
          setStreamingStats(prev => ({
            ...prev,
            chunksSent: prev.chunksSent + 1,
            bytesSent: prev.bytesSent + chunk.sizeBytes
          }));
        } else {
          // Failed to send chunk, attempt retry
          console.log(`Failed to send chunk ${chunk.id}, attempting retry...`);
          
          // Inline retry logic
          let retryCount = 0;
          let retrySuccess = false;
          
          while (retryCount < 3 && isStreaming && !retrySuccess) {
            try {
              if (websocketServiceRef.current?.isConnected()) {
                retrySuccess = websocketServiceRef.current.sendAudioChunk(
                  chunk.id,
                  chunk.data,
                  {
                    index: chunk.index,
                    durationMs: chunk.durationMs,
                    format: chunk.format,
                    sampleRate: 16000,
                    channels: 1,
                    retryCount: retryCount + 1
                  }
                );
              }
              
              if (retrySuccess) {
                console.log(`Successfully resent chunk ${chunk.id} after ${retryCount + 1} retries`);
                break;
              }
              
              retryCount++;
              if (retryCount < 3 && isStreaming) {
                const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            } catch (error) {
              console.error(`Error retrying chunk ${chunk.id}:`, error);
              retryCount++;
            }
          }
          
          if (retrySuccess) {
            setStreamingStats(prev => ({
              ...prev,
              chunksSent: prev.chunksSent + 1,
              bytesSent: prev.bytesSent + chunk.sizeBytes
            }));
          } else {
            console.error(`Failed to send chunk ${chunk.id} after retries`);
            // Add to buffer for later retry when connection is restored
            failedChunksBufferRef.current.push(chunk);
            
            // Limit buffer size to prevent memory issues
            const maxBufferSize = 50; // Maximum 50 chunks in buffer
            if (failedChunksBufferRef.current.length > maxBufferSize) {
              console.warn(`Failed chunk buffer full, removing oldest chunks`);
              failedChunksBufferRef.current = failedChunksBufferRef.current.slice(-maxBufferSize);
            }
          }
        }
      } else if (isStreaming && !websocketServiceRef.current?.isConnected()) {
        // Connection lost during streaming
        handleConnectionLoss();
      }
    });

    // Set up transcription callback
    audioRecorderService.onTranscription((transcription: TranscriptionResult) => {
      console.log('Transcription received:', transcription.text);
    });

    // Set up scam prediction callback
    audioRecorderService.onScamPrediction((prediction: ScamPrediction) => {
      console.log('Scam prediction received:', prediction.prediction);
    });

    // Set up error callback
    audioRecorderService.onError((error: string) => {
      console.error('Audio recorder error:', error);
      Alert.alert('Recording Error', error);
    });

    // Initialize audio recorder
    audioRecorderService.initialize();

    // Cleanup on unmount
    return () => {
      audioRecorderService.removeChunkCallback(() => {});
      audioRecorderService.removeTranscriptionCallback(() => {});
      audioRecorderService.removeScamPredictionCallback(() => {});
      audioRecorderService.removeErrorCallback(() => {});
      disconnectWebSocket();
      
      // Clear any pending retry timeouts
      if (connectionRetryTimeoutRef.current) {
        clearTimeout(connectionRetryTimeoutRef.current);
        connectionRetryTimeoutRef.current = null;
      }
      
      // Clear failed chunks buffer
      failedChunksBufferRef.current = [];
    };
  }, [isStreaming, disconnectWebSocket]);

  // Load family members from storage on mount
  useEffect(() => {
    const initApp = async () => {
      try {
        const storedMembers = await AsyncStorage.getItem('familyMembers');
        if (storedMembers) {
          try {
            setFamilyMembers(JSON.parse(storedMembers));
          } catch (parseError) {
            console.log('Failed to parse stored members');
          }
        }
      } catch (error) {
        console.log('Error loading family members');
      } finally {
        setIsReady(true);
      }
    };
    initApp();
  }, []);

  const saveFamilyMember = useCallback(() => {
    if (!name.trim() || !phoneNumber.trim() || !relation.trim()) {
      Alert.alert('Missing Information', 'Please fill in name, phone number, and relation.');
      return;
    }

    const phoneDigits = phoneNumber.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      Alert.alert('Invalid Phone Number', 'Please enter a valid 10-digit phone number.');
      return;
    }

    const newMember: FamilyMember = {
      id: Date.now().toString(),
      name,
      phoneNumber: phoneDigits,
      relation,
      securityQuestion: securityQuestion.trim() || 'What is your birth city?',
      securityAnswer: securityAnswer.trim() || 'Default',
    };

    const updatedMembers = [...familyMembers, newMember];
    setFamilyMembers(updatedMembers);
    
    AsyncStorage.setItem('familyMembers', JSON.stringify(updatedMembers))
      .then(() => {
        Alert.alert('Success', 'Family member added!');
        setName('');
        setPhoneNumber('');
        setRelation('');
        setSecurityQuestion('');
        setSecurityAnswer('');
      })
      .catch(() => {
        Alert.alert('Error', 'Failed to save.');
      });
  }, [name, phoneNumber, relation, securityQuestion, securityAnswer, familyMembers]);

  const deleteFamilyMember = useCallback((id: string) => {
    const updatedMembers = familyMembers.filter(member => member.id !== id);
    setFamilyMembers(updatedMembers);
    
    AsyncStorage.setItem('familyMembers', JSON.stringify(updatedMembers))
      .then(() => {
        Alert.alert('Deleted', 'Member removed.');
      })
      .catch(() => {
        Alert.alert('Error', 'Failed to delete.');
      });
  }, [familyMembers]);

  // Stop audio recording
  const stopRecording = useCallback(async () => {
    if (!recording || !recordingType) return;

    try {
      // Stop WebSocket streaming
      if (websocketServiceRef.current) {
        websocketServiceRef.current.stopStreaming();
      }

      // Stop audio recording
      const chunks = await audioRecorderService.stopRecording();
      
      // Update streaming session
      if (streamingSessionRef.current) {
        streamingSessionRef.current.isActive = false;
      }

      // Update UI state
      setRecording(false);
      setRecordingType(null);
      setIsStreaming(false);

      // Show results summary
      const stats = audioRecorderService.getStats();
      const durationSeconds = Math.round(stats.durationMs / 1000);
      const scamCount = predictions.filter(p => p.prediction === 'scam').length;
      
      let summaryMessage = `Recording complete!\n\n`;
      summaryMessage += `Duration: ${durationSeconds} seconds\n`;
      summaryMessage += `Audio chunks sent: ${streamingStats.chunksSent}\n`;
      summaryMessage += `Transcriptions received: ${transcriptions.length}\n`;
      
      if (latestPrediction) {
        summaryMessage += `\nLatest scam detection: ${latestPrediction.prediction}\n`;
        summaryMessage += `Confidence: ${(latestPrediction.confidence * 100).toFixed(1)}%\n`;
        summaryMessage += `Risk level: ${latestPrediction.riskLevel}`;
      }

      Alert.alert(
        'Recording Complete',
        summaryMessage,
        [{ text: 'OK' }]
      );

      // Log session details
      console.log('Recording session ended:', {
        duration: stats.durationMs,
        chunks: stats.chunksRecorded,
        bytes: stats.bytesRecorded,
        latency: stats.processingLatency,
        scamDetections: scamCount,
        transcriptions: transcriptions.length
      });

    } catch (error) {
      console.error('Error stopping recording:', error);
      Alert.alert('Error', 'Failed to stop recording properly');
      
      // Force cleanup
      setRecording(false);
      setRecordingType(null);
      setIsStreaming(false);
      audioRecorderService.cleanup();
      disconnectWebSocket();
    }
  }, [recording, recordingType, predictions, transcriptions, latestPrediction, streamingStats, disconnectWebSocket]);

  const startRecording = useCallback(async (callerType: 'family' | 'spammer') => {
    if (recording) return;

    const startRecordingProcess = async () => {
      try {
        // Connect to WebSocket first
        setLoading(true);
        const connected = await connectWebSocket();
        
        if (!connected) {
          setLoading(false);
          Alert.alert('Connection Failed', 'Unable to connect to streaming server');
          return;
        }

        // Start WebSocket streaming session
        const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        streamingSessionRef.current = {
          sessionId,
          isActive: true,
          startTime: Date.now(),
          chunksSent: 0,
          transcriptions: [],
          predictions: []
        };

        if (websocketServiceRef.current) {
          websocketServiceRef.current.startStreaming(sessionId, {
            callerType,
            sampleRate: 16000,
            channels: 1,
            format: 'pcm'
          });
        }

        // Reset streaming stats
        setStreamingStats({
          chunksSent: 0,
          bytesSent: 0,
          latencyMs: 0,
          connectionTime: Date.now()
        });

        // Reset transcriptions and predictions
        setTranscriptions([]);
        setPredictions([]);
        setLatestPrediction(null);

        // Start audio recording
        const recordingStarted = await audioRecorderService.startRecording();
        
        if (recordingStarted) {
          setRecording(true);
          setRecordingType(callerType);
          setIsStreaming(true);
          setLoading(false);
          
          Alert.alert(
            'Recording Started', 
            `Recording ${callerType} call with real-time scam detection...`,
            [{ text: 'OK' }]
          );
        } else {
          setLoading(false);
          Alert.alert('Recording Error', 'Failed to start audio recording');
          disconnectWebSocket();
        }

      } catch (error) {
        setLoading(false);
        console.error('Error starting recording:', error);
        Alert.alert('Recording Error', 'Failed to start recording process');
        disconnectWebSocket();
      }
    };

    if (Platform.OS === 'android') {
      PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Audio Recording Permission',
          message: 'VoxShield needs microphone access to record calls.',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      ).then((granted) => {
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          startRecordingProcess();
        } else {
          Alert.alert('Permission Required', 'Microphone permission is required.');
        }
      });
    } else {
      startRecordingProcess();
    }
  }, [recording, connectWebSocket, disconnectWebSocket]);

  const renderFamilyMember = useCallback(({ item }: { item: FamilyMember }) => (
    <View style={styles.memberCard}>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{item.name}</Text>
        <Text style={styles.memberDetails}>📞 {item.phoneNumber}</Text>
        <Text style={styles.memberDetails}>👥 {item.relation}</Text>
        {item.securityQuestion ? (
          <Text style={styles.securityDetails}>🔒 {item.securityQuestion}</Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => deleteFamilyMember(item.id)}
      >
        <Text style={styles.deleteButtonText}>✕</Text>
      </TouchableOpacity>
    </View>
  ), [deleteFamilyMember]);

  // Render real-time transcription and prediction UI
  const renderRealTimeInfo = useCallback(() => {
    if (!isStreaming && transcriptions.length === 0) {
      return null;
    }

    const latestTranscription = transcriptions.length > 0 
      ? transcriptions[transcriptions.length - 1]
      : null;

    return (
      <View style={styles.realTimeContainer}>
        <Text style={styles.realTimeTitle}>Real-Time Analysis</Text>
        
        {/* WebSocket Status */}
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Connection:</Text>
          <View style={[
            styles.statusIndicator, 
            websocketStatus === 'connected' ? styles.statusConnected :
            websocketStatus === 'connecting' ? styles.statusConnecting :
            styles.statusDisconnected
          ]}>
            <Text style={styles.statusText}>
              {websocketStatus === 'connected' ? '🟢 Connected' :
               websocketStatus === 'connecting' ? '🟡 Connecting' :
               '🔴 Disconnected'}
            </Text>
          </View>
        </View>

        {/* Connection Error Display */}
        {connectionError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>⚠️ {connectionError}</Text>
            {reconnectionAttempts > 0 && (
              <Text style={styles.errorSubtext}>
                Reconnection attempts: {reconnectionAttempts}
              </Text>
            )}
            {failedChunksBufferRef.current.length > 0 && (
              <Text style={styles.errorSubtext}>
                Buffered chunks: {failedChunksBufferRef.current.length}
              </Text>
            )}
          </View>
        )}

        {/* Streaming Stats */}
        {isStreaming && (
          <View style={styles.statsContainer}>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Chunks sent:</Text>
              {streamingStats.chunksSent > 0 ? (
                <Text style={styles.statValue}>{streamingStats.chunksSent}</Text>
              ) : (
                <SkeletonLoader height={16} width={40} />
              )}
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Data sent:</Text>
              {streamingStats.bytesSent > 0 ? (
                <Text style={styles.statValue}>{(streamingStats.bytesSent / 1024).toFixed(1)} KB</Text>
              ) : (
                <SkeletonLoader height={16} width={60} />
              )}
            </View>
          </View>
        )}

        {/* Latest Transcription */}
        {isStreaming && !latestTranscription ? (
          <View style={styles.transcriptionContainer}>
            <SkeletonLoader height={14} width={120} />
            <View style={styles.skeletonTextContainer}>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <SkeletonLoader height={12} width="45%" />
                <SkeletonLoader height={12} width="50%" />
              </View>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <SkeletonLoader height={12} width="40%" />
                <SkeletonLoader height={12} width="55%" />
              </View>
            </View>
            <SkeletonLoader height={10} width={80} />
          </View>
        ) : latestTranscription ? (
          <View style={styles.transcriptionContainer}>
            <Text style={styles.transcriptionTitle}>
              {latestTranscription.isFinal ? '✅ Final Transcription' : '⏳ Live Transcription'}
            </Text>
            <Text style={styles.transcriptionText}>{latestTranscription.text}</Text>
            {latestTranscription.confidence > 0 && (
              <Text style={styles.confidenceText}>
                Confidence: {(latestTranscription.confidence * 100).toFixed(1)}%
              </Text>
            )}
          </View>
        ) : null}

        {/* Latest Scam Prediction */}
        {isStreaming && !latestPrediction ? (
          <View style={styles.predictionContainer}>
            <SkeletonLoader height={16} width={140} />
            <SkeletonLoader height={12} width={100} />
            <SkeletonLoader height={10} width={80} />
          </View>
        ) : latestPrediction ? (
          <View style={[
            styles.predictionContainer,
            latestPrediction.prediction === 'scam' ? styles.predictionScam : styles.predictionLegitimate
          ]}>
            <Text style={styles.predictionTitle}>
              {latestPrediction.prediction === 'scam' ? '🚨 SCAM DETECTED' : '✅ LEGITIMATE CALL'}
            </Text>
            <Text style={styles.predictionText}>
              Confidence: {(latestPrediction.confidence * 100).toFixed(1)}%
            </Text>
            <Text style={styles.riskLevelText}>
              Risk Level: {latestPrediction.riskLevel.toUpperCase()}
            </Text>
          </View>
        ) : null}

        {/* Transcription History */}
        {transcriptions.length > 1 && (
          <View style={styles.historyContainer}>
            <Text style={styles.historyTitle}>
              Transcription History ({transcriptions.length})
            </Text>
            <ScrollView style={styles.historyScroll} horizontal>
              {transcriptions.slice(-5).map((t, index) => (
                <View key={index} style={styles.historyItem}>
                  <Text style={styles.historyText} numberOfLines={2}>
                    {t.text}
                  </Text>
                  <Text style={styles.historyMeta}>
                    {t.isFinal ? 'Final' : 'Partial'} • {(t.confidence * 100).toFixed(0)}%
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    );
  }, [isStreaming, transcriptions, latestPrediction, websocketStatus, streamingStats]);

  if (!isReady) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'family' && styles.activeTab]}
          onPress={() => setActiveTab('family')}
        >
          <Text style={[styles.tabText, activeTab === 'family' && styles.activeTabText]}>
            👨‍👩‍👧‍👦 Family
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.tab, activeTab === 'home' && styles.activeTab]}
          onPress={() => setActiveTab('home')}
        >
          <Text style={[styles.tabText, activeTab === 'home' && styles.activeTabText]}>
            🏠 Home
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'family' && (
        <ScrollView style={styles.tabContent}>
          <View style={styles.formContainer}>
            <Text style={styles.sectionTitle}>Add Family Member</Text>
            
            <TextInput
              style={styles.input}
              placeholder="Name"
              value={name}
              onChangeText={setName}
              placeholderTextColor="#999"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Phone Number (10 digits)"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              placeholderTextColor="#999"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Relation"
              value={relation}
              onChangeText={setRelation}
              placeholderTextColor="#999"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Security Question"
              value={securityQuestion}
              onChangeText={setSecurityQuestion}
              placeholderTextColor="#999"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Security Answer"
              value={securityAnswer}
              onChangeText={setSecurityAnswer}
              secureTextEntry
              placeholderTextColor="#999"
            />
            
            <TouchableOpacity style={styles.addButton} onPress={saveFamilyMember}>
              <Text style={styles.addButtonText}>Add Member</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.listContainer}>
            <Text style={styles.sectionTitle}>
              Members ({familyMembers.length})
            </Text>
            
            {familyMembers.length === 0 ? (
              <Text style={styles.emptyText}>
                No members added yet.
              </Text>
            ) : (
              <FlatList
                data={familyMembers}
                renderItem={renderFamilyMember}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
              />
            )}
          </View>
        </ScrollView>
      )}

      {activeTab === 'home' && (
        <ScrollView style={styles.tabContent}>
          <View style={styles.homeContainer}>
            <Text style={styles.homeTitle}>VoxShield</Text>
            <Text style={styles.homeSubtitle}>
              {recording 
                ? '🔴 Recording in progress...' 
                : 'Start recording a call'}
            </Text>
            
            {/* Loading indicator */}
            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.loadingText}>Connecting to server...</Text>
              </View>
            )}

            {/* Real-time analysis display */}
            {renderRealTimeInfo()}
            
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.callButton, styles.familyButton]}
                onPress={() => startRecording('family')}
                disabled={recording || loading}
              >
                <Text style={styles.callButtonText}>📞 Family Call</Text>
                <Text style={styles.callButtonSubtext}>Test with known contacts</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.callButton, styles.spammerButton]}
                onPress={() => startRecording('spammer')}
                disabled={recording || loading}
              >
                <Text style={styles.callButtonText}>🚫 Spammer Call</Text>
                <Text style={styles.callButtonSubtext}>Test scam detection</Text>
              </TouchableOpacity>
            </View>

            {/* Test Button */}
            <TouchableOpacity
              style={styles.testButton}
              onPress={() => setShowTestPanel(true)}
              disabled={recording}
            >
              <Text style={styles.testButtonText}>🧪 Test Streaming Performance</Text>
            </TouchableOpacity>

            {/* Performance Optimization Button */}
            {performanceStats && performanceStats.score < 80 && (
              <TouchableOpacity
                style={styles.performanceButton}
                onPress={() => setShowPerformanceTips(true)}
              >
                <Text style={styles.performanceButtonText}>
                  ⚡ Performance Tips ({performanceStats.score}/100)
                </Text>
              </TouchableOpacity>
            )}
            
            {recording && (
              <>
                <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
                  <Text style={styles.stopButtonText}>⏹️ Stop Recording</Text>
                </TouchableOpacity>
                
                <View style={styles.recordingInfo}>
                  <Text style={styles.recordingInfoText}>
                    Real-time streaming active • {recordingType} call
                  </Text>
                  <Text style={styles.recordingInfoSubtext}>
                    Audio chunks being sent every 200ms for scam analysis
                  </Text>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      )}

      {/* Streaming Test Panel */}
      <StreamingTestPanel
        visible={showTestPanel}
        onClose={() => setShowTestPanel(false)}
      />

      {/* Performance Tips Panel */}
      <PerformanceTipsPanel
        visible={showPerformanceTips}
        performanceReport={performanceStats}
        onClose={() => setShowPerformanceTips(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: { flex: 1, paddingVertical: 16, alignItems: 'center' },
  activeTab: { borderBottomWidth: 3, borderBottomColor: '#007AFF' },
  tabText: { fontSize: 16, color: '#666' },
  activeTabText: { color: '#007AFF', fontWeight: 'bold' },
  tabContent: { flex: 1 },
  formContainer: {
    backgroundColor: '#fff',
    padding: 20,
    margin: 16,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  input: {
    backgroundColor: '#f8f8f8',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  listContainer: { padding: 16 },
  emptyText: { textAlign: 'center', color: '#666', fontSize: 16, marginTop: 20 },
  memberCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 4 },
  memberDetails: { fontSize: 14, color: '#666', marginBottom: 2 },
  securityDetails: { fontSize: 12, color: '#888', marginTop: 4 },
  deleteButton: {
    backgroundColor: '#ff3b30',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  deleteButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  homeContainer: { flex: 1, padding: 20, alignItems: 'center', justifyContent: 'flex-start' },
  loadingContainer: { flex: 1, backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 18, color: '#666' },
  homeTitle: { fontSize: 28, fontWeight: 'bold', color: '#333', marginBottom: 8, textAlign: 'center' },
  homeSubtitle: { fontSize: 16, color: '#666', marginBottom: 20, textAlign: 'center' },
  buttonContainer: { width: '100%', gap: 20, marginTop: 20 },
  callButton: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  familyButton: { borderWidth: 3, borderColor: '#4CD964' },
  spammerButton: { borderWidth: 3, borderColor: '#FF3B30' },
  callButtonText: { fontSize: 20, fontWeight: 'bold', marginBottom: 4, color: '#333' },
  callButtonSubtext: { fontSize: 12, color: '#666' },
  stopButton: {
    backgroundColor: '#FF3B30',
    padding: 16,
    borderRadius: 12,
    marginTop: 20,
    width: '100%',
    alignItems: 'center',
  },
  stopButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  recordingInfo: {
    backgroundColor: '#f0f7ff',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
    width: '100%',
    alignItems: 'center',
  },
  recordingInfoText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 4,
  },
  recordingInfoSubtext: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  testButton: {
    backgroundColor: '#6c757d',
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
    width: '100%',
    alignItems: 'center',
  },
  testButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  performanceButton: {
    backgroundColor: '#FF9500',
    padding: 14,
    borderRadius: 12,
    marginTop: 12,
    width: '100%',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  performanceButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },

  // Real-time UI styles
  realTimeContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  realTimeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusLabel: {
    fontSize: 14,
    color: '#666',
  },
  statusIndicator: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusConnected: { backgroundColor: '#e6f4ea' },
  statusConnecting: { backgroundColor: '#fff3cd' },
  statusDisconnected: { backgroundColor: '#f8d7da' },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  statRow: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  transcriptionContainer: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  transcriptionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 8,
  },
  transcriptionText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
    lineHeight: 20,
  },
  confidenceText: {
    fontSize: 11,
    color: '#888',
    textAlign: 'right',
  },
  predictionContainer: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  predictionScam: {
    backgroundColor: '#f8d7da',
    borderWidth: 1,
    borderColor: '#f5c6cb',
  },
  predictionLegitimate: {
    backgroundColor: '#e6f4ea',
    borderWidth: 1,
    borderColor: '#d4edda',
  },
  predictionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  predictionText: {
    fontSize: 12,
    marginBottom: 4,
    textAlign: 'center',
  },
  riskLevelText: {
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  historyContainer: {
    marginTop: 12,
  },
  historyTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 8,
  },
  historyScroll: {
    flexDirection: 'row',
  },
  historyItem: {
    backgroundColor: '#f8f9fa',
    padding: 8,
    borderRadius: 6,
    marginRight: 8,
    width: 120,
  },
  historyText: {
    fontSize: 10,
    color: '#333',
    marginBottom: 4,
  },
  historyMeta: {
    fontSize: 9,
    color: '#888',
  },
  errorContainer: {
    backgroundColor: '#fff3cd',
    borderWidth: 1,
    borderColor: '#ffeaa7',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 12,
    color: '#856404',
    marginBottom: 4,
  },
  errorSubtext: {
    fontSize: 10,
    color: '#856404',
    opacity: 0.8,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  skeletonTextContainer: {
    marginVertical: 8,
    gap: 4,
  },
});