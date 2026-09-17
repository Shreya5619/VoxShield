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
  // TODO: Update this with your actual API Gateway WebSocket URL
  // Format: wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}
  // Get this from: amplify push -> API Gateway -> Stages -> {stage} -> URL
  websocketUrl: 'wss://your-api-gateway-url.amazonaws.com/prod',
  
  // AWS Region
  awsRegion: 'us-east-1',
  
  // Recording settings
  maxRecordingDuration: 300, // 5 minutes
  chunkDurationMs: 200, // 200ms chunks for real-time streaming
};

export default appConfig;
