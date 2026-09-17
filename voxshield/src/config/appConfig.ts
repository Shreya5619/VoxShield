/**
 * Application Configuration
 * Centralized config for all environment-specific settings
 */

export interface AppConfig {
  /** WebSocket URL for real-time audio streaming */
  websocketUrl: string;
  /** AWS Region for backend services */
  awsRegion: string;
  /** Maximum recording duration in seconds */
  maxRecordingDuration: number;
  /** Chunk size for audio streaming */
  chunkDurationMs: number;
}

export const appConfig: AppConfig = {
  // WebSocket URL
  // Reads from EXPO_PUBLIC_WEBSOCKET_URL environment variable
  // Format: wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}
  websocketUrl: typeof process.env.EXPO_PUBLIC_WEBSOCKET_URL !== 'undefined' 
    ? process.env.EXPO_PUBLIC_WEBSOCKET_URL 
    : 'wss://your-api-gateway-url.amazonaws.com/prod',
  
  // AWS Region
  awsRegion: 'us-east-1',
  
  // Recording settings
  maxRecordingDuration: 300, // 5 minutes
  chunkDurationMs: 200, // 200ms chunks for real-time streaming
};

// Log config for debugging (remove in production)
console.log('App Config - WebSocket URL:', appConfig.websocketUrl);
console.log('App Config - Environment EXPO_PUBLIC_WEBSOCKET_URL:', process.env.EXPO_PUBLIC_WEBSOCKET_URL);

export default appConfig;
