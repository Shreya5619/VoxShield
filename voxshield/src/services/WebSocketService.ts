import { Platform } from 'react-native';

/**
 * WebSocket Service for real-time communication with backend
 * Handles connection management, message sending/receiving, and reconnection logic
 */

export interface WebSocketConfig {
  /** WebSocket server URL */
  serverUrl: string;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
  /** Reconnection delay in milliseconds */
  reconnectDelay?: number;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Enable automatic reconnection */
  autoReconnect?: boolean;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval?: number;
  /** Query parameters for connection */
  queryParams?: Record<string, string>;
}

export interface WebSocketMessage {
  /** Message type */
  type: string;
  /** Message data */
  data: any;
  /** Message timestamp */
  timestamp?: number;
  /** Message ID */
  messageId?: string;
}

export interface ConnectionStats {
  /** Connection status */
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  /** Connection start time */
  connectedAt?: number;
  /** Last message received timestamp */
  lastMessageAt?: number;
  /** Total messages sent */
  messagesSent: number;
  /** Total messages received */
  messagesReceived: number;
  /** Connection errors count */
  errors: number;
  /** Reconnection attempts */
  reconnectAttempts: number;
}

export type MessageCallback = (message: WebSocketMessage) => void;
export type ConnectionCallback = (status: ConnectionStats) => void;
export type ErrorCallback = (error: string) => void;

class WebSocketService {
  private socket: WebSocket | null = null;
  private config: WebSocketConfig;
  private stats: ConnectionStats;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private connectionTimeoutTimer: NodeJS.Timeout | null = null;

  private messageCallbacks: MessageCallback[] = [];
  private connectionCallbacks: ConnectionCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];

  constructor(config: WebSocketConfig) {
    this.config = {
      serverUrl: config.serverUrl,
      connectionTimeout: 10000, // 10 seconds
      reconnectDelay: 3000, // 3 seconds
      maxReconnectAttempts: 5,
      autoReconnect: true,
      heartbeatInterval: 30000, // 30 seconds
      queryParams: {},
      ...config
    };

    this.stats = {
      status: 'disconnected',
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0,
      reconnectAttempts: 0
    };
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        console.log('WebSocket already connected');
        resolve(true);
        return;
      }

      this.updateStatus('connecting');

      try {
        // Build URL with query parameters
        const url = this.buildWebSocketUrl();
        
        // Create WebSocket connection
        this.socket = new WebSocket(url);

        // Set up event listeners
        this.setupEventListeners();

        // Set connection timeout
        this.connectionTimeoutTimer = setTimeout(() => {
          if (this.stats.status === 'connecting') {
            this.handleError('Connection timeout');
            resolve(false);
          }
        }, this.config.connectionTimeout!);

        // Wait for connection
        const checkConnection = () => {
          if (this.stats.status === 'connected') {
            resolve(true);
          } else if (this.stats.status === 'error') {
            resolve(false);
          } else {
            setTimeout(checkConnection, 100);
          }
        };

        checkConnection();

      } catch (error) {
        this.handleError(`Connection failed: ${error}`);
        resolve(false);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    // Clear timers
    this.clearTimers();

    // Close WebSocket connection
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    // Update status
    this.updateStatus('disconnected');
    this.reconnectAttempts = 0;

    console.log('WebSocket disconnected');
  }

  /**
   * Send message to WebSocket server
   */
  sendMessage(type: string, data: any): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.handleError('Cannot send message: WebSocket not connected');
      return false;
    }

    try {
      const message: WebSocketMessage = {
        type,
        data,
        timestamp: Date.now(),
        messageId: this.generateMessageId()
      };

      const messageStr = JSON.stringify(message);
      this.socket.send(messageStr);

      // Update stats
      this.stats.messagesSent++;

      console.log(`Sent message: ${type}`, data);
      return true;

    } catch (error) {
      this.handleError(`Failed to send message: ${error}`);
      return false;
    }
  }

  /**
   * Send audio chunk to server
   */
  sendAudioChunk(chunkId: string, audioData: string, metadata: any = {}): boolean {
    return this.sendMessage('audio_chunk', {
      chunkId,
      audioData,
      timestamp: Date.now(),
      ...metadata
    });
  }

  /**
   * Start audio streaming session
   */
  startStreaming(sessionId: string, metadata: any = {}): boolean {
    return this.sendMessage('start_streaming', {
      sessionId,
      timestamp: Date.now(),
      ...metadata
    });
  }

  /**
   * Stop audio streaming session
   */
  stopStreaming(): boolean {
    return this.sendMessage('stop_streaming', {
      timestamp: Date.now()
    });
  }

  /**
   * Send ping/heartbeat
   */
  sendPing(): boolean {
    return this.sendMessage('ping', {
      timestamp: Date.now()
    });
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStats {
    return { ...this.stats };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.stats.status === 'connected' && 
           this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Register message callback
   */
  onMessage(callback: MessageCallback): void {
    this.messageCallbacks.push(callback);
  }

  /**
   * Register connection status callback
   */
  onConnectionStatus(callback: ConnectionCallback): void {
    this.connectionCallbacks.push(callback);
  }

  /**
   * Register error callback
   */
  onError(callback: ErrorCallback): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * Remove message callback
   */
  removeMessageCallback(callback: MessageCallback): void {
    this.messageCallbacks = this.messageCallbacks.filter(cb => cb !== callback);
  }

  /**
   * Remove connection status callback
   */
  removeConnectionCallback(callback: ConnectionCallback): void {
    this.connectionCallbacks = this.connectionCallbacks.filter(cb => cb !== callback);
  }

  /**
   * Remove error callback
   */
  removeErrorCallback(callback: ErrorCallback): void {
    this.errorCallbacks = this.errorCallbacks.filter(cb => cb !== callback);
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.disconnect();
    this.clearCallbacks();
    console.log('WebSocket service cleaned up');
  }

  /**
   * Build WebSocket URL with query parameters
   */
  private buildWebSocketUrl(): string {
    const { serverUrl, queryParams } = this.config;
    
    if (!queryParams || Object.keys(queryParams).length === 0) {
      return serverUrl;
    }

    const params = new URLSearchParams(queryParams);
    return `${serverUrl}?${params.toString()}`;
  }

  /**
   * Set up WebSocket event listeners
   */
  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.onopen = () => this.handleOpen();
    this.socket.onmessage = (event) => this.handleMessage(event);
    this.socket.onerror = (error) => this.handleSocketError(error);
    this.socket.onclose = (event) => this.handleClose(event);
  }

  /**
   * Handle WebSocket open event
   */
  private handleOpen(): void {
    console.log('WebSocket connected');
    
    // Clear connection timeout
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }

    // Reset reconnect attempts
    this.reconnectAttempts = 0;

    // Update status
    this.updateStatus('connected');
    this.stats.connectedAt = Date.now();

    // Start heartbeat
    this.startHeartbeat();
  }

  /**
   * Handle WebSocket message event
   */
  private handleMessage(event: WebSocketMessageEvent): void {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      
      // Update stats
      this.stats.messagesReceived++;
      this.stats.lastMessageAt = Date.now();

      // Handle special message types
      this.handleSpecialMessage(message);

      // Emit to callbacks
      this.emitMessage(message);

      console.log(`Received message: ${message.type}`, message.data);

    } catch (error) {
      this.handleError(`Failed to parse message: ${error}`);
    }
  }

  /**
   * Handle special message types (ping/pong, errors, etc.)
   */
  private handleSpecialMessage(message: WebSocketMessage): void {
    switch (message.type) {
      case 'pong':
        // Received pong response to our ping
        console.log('Received pong response');
        break;

      case 'error':
        console.error('Server error:', message.data);
        this.handleError(`Server error: ${message.data.message || 'Unknown error'}`);
        break;

      case 'connection_established':
        console.log('Connection established:', message.data);
        break;

      default:
        // Handle other special messages if needed
        break;
    }
  }

  /**
   * Handle WebSocket error event
   */
  private handleSocketError(error: WebSocketErrorEvent): void {
    const errorMsg = `WebSocket error: ${error.type}`;
    console.error(errorMsg, error);
    this.handleError(errorMsg);
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(event: WebSocketCloseEvent): void {
    console.log(`WebSocket closed: code=${event.code}, reason=${event.reason}`);
    
    // Clear heartbeat
    this.stopHeartbeat();

    // Handle reconnection
    if (this.config.autoReconnect && 
        this.reconnectAttempts < this.config.maxReconnectAttempts!) {
      
      this.scheduleReconnection();
      
    } else {
      this.updateStatus('disconnected');
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnection(): void {
    this.reconnectAttempts++;
    this.stats.reconnectAttempts = this.reconnectAttempts;
    
    const delay = this.config.reconnectDelay!;
    console.log(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.updateStatus('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      console.log(`Attempting reconnection ${this.reconnectAttempts}`);
      this.connect();
    }, delay);
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.sendPing();
      }
    }, this.config.heartbeatInterval!);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }
  }

  /**
   * Clear all callbacks
   */
  private clearCallbacks(): void {
    this.messageCallbacks = [];
    this.connectionCallbacks = [];
    this.errorCallbacks = [];
  }

  /**
   * Update connection status
   */
  private updateStatus(status: ConnectionStats['status']): void {
    this.stats.status = status;
    this.emitConnectionStatus();
  }

  /**
   * Handle error
   */
  private handleError(error: string): void {
    console.error('WebSocket error:', error);
    
    this.stats.errors++;
    this.emitError(error);

    // Update status if not already in error state
    if (this.stats.status !== 'error') {
      this.updateStatus('error');
    }
  }

  /**
   * Emit message to callbacks
   */
  private emitMessage(message: WebSocketMessage): void {
    this.messageCallbacks.forEach(callback => {
      try {
        callback(message);
      } catch (error) {
        console.error('Error in message callback:', error);
      }
    });
  }

  /**
   * Emit connection status to callbacks
   */
  private emitConnectionStatus(): void {
    this.connectionCallbacks.forEach(callback => {
      try {
        callback(this.getStatus());
      } catch (error) {
        console.error('Error in connection callback:', error);
      }
    });
  }

  /**
   * Emit error to callbacks
   */
  private emitError(error: string): void {
    this.errorCallbacks.forEach(callback => {
      try {
        callback(error);
      } catch (error) {
        console.error('Error in error callback:', error);
      }
    });
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export factory function for creating WebSocket service instances
export const createWebSocketService = (config: WebSocketConfig): WebSocketService => {
  return new WebSocketService(config);
};

// Default WebSocket service instance (singleton pattern)
let defaultInstance: WebSocketService | null = null;

export const getWebSocketService = (config?: WebSocketConfig): WebSocketService => {
  if (!defaultInstance && config) {
    defaultInstance = createWebSocketService(config);
  }
  
  if (!defaultInstance) {
    throw new Error('WebSocketService not initialized. Call getWebSocketService with config first.');
  }
  
  return defaultInstance;
};

export default WebSocketService;