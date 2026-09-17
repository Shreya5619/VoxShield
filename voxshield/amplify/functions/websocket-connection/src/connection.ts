import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyWebsocketEventV2, Context } from "aws-lambda";

const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const CONNECTION_TABLE = process.env.CONNECTION_TABLE || "VoxShieldConnections";

interface ConnectionRecord {
  connectionId: string;
  createdAt: string;
  lastActive: string;
  userId?: string;
  sessionId?: string;
}

/**
 * WebSocket connection handler for API Gateway WebSocket API
 * Routes: $connect, $disconnect, $default
 */
export const handler = async (event: APIGatewayProxyWebsocketEventV2, context: Context): Promise<any> => {
  console.log("WebSocket event:", JSON.stringify(event, null, 2));
  
  const { requestContext } = event;
  const { connectionId, routeKey } = requestContext;
  
  try {
    switch (routeKey) {
      case "$connect":
        return await handleConnect(connectionId, event);
      case "$disconnect":
        return await handleDisconnect(connectionId);
      case "$default":
        return await handleDefault(connectionId, event);
      default:
        console.log(`Unknown route key: ${routeKey}`);
        return { statusCode: 400, body: "Unknown route" };
    }
  } catch (error) {
    console.error("Error handling WebSocket event:", error);
    return { statusCode: 500, body: "Internal server error" };
  }
};

/**
 * Handle new WebSocket connection
 */
async function handleConnect(connectionId: string, event: any): Promise<any> {
  console.log(`New connection: ${connectionId}`);
  
  const queryParams = event.queryStringParameters || {};
  const sessionId = queryParams.sessionId || `session_${Date.now()}`;
  const userId = queryParams.userId || "anonymous";
  
  const connectionRecord: ConnectionRecord = {
    connectionId,
    createdAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    userId,
    sessionId
  };
  
  try {
    // Store connection in DynamoDB
    await ddbDocClient.send(new PutCommand({
      TableName: CONNECTION_TABLE,
      Item: connectionRecord
    }));
    
    console.log(`Connection ${connectionId} stored successfully`);
    
    // Send welcome message
    await sendMessage(connectionId, {
      type: "connection_established",
      connectionId,
      sessionId,
      userId,
      timestamp: new Date().toISOString(),
      message: "WebSocket connection established"
    });
    
    return { statusCode: 200, body: "Connected" };
  } catch (error) {
    console.error("Error storing connection:", error);
    return { statusCode: 500, body: "Failed to store connection" };
  }
}

/**
 * Handle WebSocket disconnection
 */
async function handleDisconnect(connectionId: string): Promise<any> {
  console.log(`Disconnection: ${connectionId}`);
  
  try {
    // Remove connection from DynamoDB
    await ddbDocClient.send(new DeleteCommand({
      TableName: CONNECTION_TABLE,
      Key: { connectionId }
    }));
    
    console.log(`Connection ${connectionId} removed from database`);
    return { statusCode: 200, body: "Disconnected" };
  } catch (error) {
    console.error("Error removing connection:", error);
    return { statusCode: 500, body: "Failed to remove connection" };
  }
}

/**
 * Handle default WebSocket messages
 */
async function handleDefault(connectionId: string, event: any): Promise<any> {
  console.log(`Default message from ${connectionId}`);
  
  const body = event.body;
  if (!body) {
    console.log("No message body received");
    return { statusCode: 400, body: "No message body" };
  }
  
  try {
    const message = JSON.parse(body);
    console.log(`Received message type: ${message.type}`);
    
    // Update last active timestamp
    await ddbDocClient.send(new PutCommand({
      TableName: CONNECTION_TABLE,
      Item: {
        connectionId,
        lastActive: new Date().toISOString()
      },
      ReturnValues: "NONE"
    }));
    
    // Echo back for testing
    if (message.type === "ping") {
      await sendMessage(connectionId, {
        type: "pong",
        timestamp: new Date().toISOString(),
        connectionId
      });
    }
    
    // Forward to appropriate handler based on message type
    switch (message.type) {
      case "audio_chunk":
        // Audio chunks will be handled by audio streaming Lambda
        console.log(`Audio chunk received: ${message.chunkId}, size: ${message.audioData?.length || 0} bytes`);
        return { statusCode: 200, body: "Audio chunk forwarded" };
      
      case "start_streaming":
        console.log(`Starting audio streaming for ${connectionId}`);
        await sendMessage(connectionId, {
          type: "streaming_started",
          timestamp: new Date().toISOString(),
          message: "Audio streaming ready"
        });
        return { statusCode: 200, body: "Streaming started" };
      
      case "stop_streaming":
        console.log(`Stopping audio streaming for ${connectionId}`);
        await sendMessage(connectionId, {
          type: "streaming_stopped",
          timestamp: new Date().toISOString(),
          message: "Audio streaming stopped"
        });
        return { statusCode: 200, body: "Streaming stopped" };
      
      default:
        console.log(`Unknown message type: ${message.type}`);
        return { statusCode: 400, body: `Unknown message type: ${message.type}` };
    }
  } catch (error) {
    console.error("Error processing message:", error);
    return { statusCode: 500, body: "Failed to process message" };
  }
}

/**
 * Send message to WebSocket client
 */
async function sendMessage(connectionId: string, message: any): Promise<void> {
  try {
    // In a real implementation, you would use the API Gateway Management API
    // This is a placeholder that would be replaced with actual WebSocket sending logic
    console.log(`Would send message to ${connectionId}:`, JSON.stringify(message, null, 2));
    
    // For now, we'll just log it
    console.log(`[WebSocket to ${connectionId}]: ${JSON.stringify(message)}`);
  } catch (error) {
    console.error(`Error sending message to ${connectionId}:`, error);
  }
}

/**
 * Get all active connections (for testing/debugging)
 */
export async function getActiveConnections(): Promise<ConnectionRecord[]> {
  try {
    const result = await ddbDocClient.send(new ScanCommand({
      TableName: CONNECTION_TABLE
    }));
    
    return result.Items as ConnectionRecord[] || [];
  } catch (error) {
    console.error("Error getting connections:", error);
    return [];
  }
}

/**
 * Broadcast message to all connections
 */
export async function broadcastMessage(message: any): Promise<void> {
  try {
    const connections = await getActiveConnections();
    console.log(`Broadcasting to ${connections.length} connections`);
    
    for (const connection of connections) {
      await sendMessage(connection.connectionId, {
        ...message,
        broadcast: true,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error("Error broadcasting message:", error);
  }
}