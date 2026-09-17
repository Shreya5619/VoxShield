import { handler } from '../src/connection';

// Mock WebSocket events for testing
const mockConnectEvent = {
  requestContext: {
    connectionId: 'test-connection-123',
    routeKey: '$connect',
    apiId: 'test-api',
    stage: 'test',
    domainName: 'test.execute-api.us-east-1.amazonaws.com',
    connectedAt: Date.now()
  },
  queryStringParameters: {
    userId: 'test-user',
    sessionId: 'test-session-456'
  },
  body: null
};

const mockDisconnectEvent = {
  requestContext: {
    connectionId: 'test-connection-123',
    routeKey: '$disconnect',
    apiId: 'test-api',
    stage: 'test',
    domainName: 'test.execute-api.us-east-1.amazonaws.com'
  },
  body: null
};

const mockDefaultEvent = (type: string, data?: any) => ({
  requestContext: {
    connectionId: 'test-connection-123',
    routeKey: '$default',
    apiId: 'test-api',
    stage: 'test',
    domainName: 'test.execute-api.us-east-1.amazonaws.com'
  },
  body: JSON.stringify({
    type,
    ...data
  })
});

async function testWebSocketHandler() {
  console.log('Testing WebSocket Connection Handler...\n');
  
  // Test $connect
  console.log('1. Testing $connect:');
  const connectResult = await handler(mockConnectEvent as any, {} as any);
  console.log(`   Status: ${connectResult.statusCode}`);
  console.log(`   Body: ${connectResult.body}\n`);
  
  // Test various message types
  const testMessages = [
    { type: 'ping', description: 'Ping message' },
    { type: 'start_streaming', description: 'Start streaming message' },
    { type: 'stop_streaming', description: 'Stop streaming message' },
    { type: 'audio_chunk', description: 'Audio chunk message', data: { chunkId: 'chunk-1', audioData: 'base64-data' } },
    { type: 'unknown_type', description: 'Unknown message type' }
  ];
  
  console.log('2. Testing message handling:');
  for (const test of testMessages) {
    const event = mockDefaultEvent(test.type, test.data);
    const result = await handler(event as any, {} as any);
    console.log(`   ${test.description}: Status ${result.statusCode}, ${result.body}`);
  }
  
  console.log('\n3. Testing $disconnect:');
  const disconnectResult = await handler(mockDisconnectEvent as any, {} as any);
  console.log(`   Status: ${disconnectResult.statusCode}`);
  console.log(`   Body: ${disconnectResult.body}\n`);
  
  console.log('Testing completed!');
}

// Run the test
testWebSocketHandler().catch(console.error);