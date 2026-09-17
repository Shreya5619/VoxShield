# WebSocket Infrastructure Setup Guide

This document describes how to set up the WebSocket infrastructure for VoxShield real-time call monitoring.

## 1. DynamoDB Table for Connection Management

Create a DynamoDB table to store WebSocket connection information:

**Table Name**: `VoxShieldConnections`

**Attributes**:
- `connectionId` (String, Partition Key)
- `createdAt` (String)
- `lastActive` (String)
- `userId` (String)
- `sessionId` (String)

**Settings**:
- Billing Mode: PAY_PER_REQUEST
- TTL Attribute: `lastActive` (optional, for automatic cleanup)

## 2. API Gateway WebSocket API

Create a WebSocket API with the following routes:

**Routes**:
- `$connect` → `websocketConnection` Lambda
- `$disconnect` → `websocketConnection` Lambda  
- `$default` → `websocketConnection` Lambda

**Configuration**:
- API Name: `VoxShieldWebSocketAPI`
- Stage: `prod`
- Connection Timeout: 10 minutes (maximum)
- Route Selection Expression: `$request.body.action`

## 3. IAM Permissions

The WebSocket connection Lambda needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem", 
        "dynamodb:DeleteItem",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/VoxShieldConnections"
    },
    {
      "Effect": "Allow",
      "Action": "execute-api:ManageConnections",
      "Resource": "arn:aws:execute-api:*:*:*"
    }
  ]
}
```

## 4. Environment Variables

Set these environment variables for the Lambda function:
- `CONNECTION_TABLE`: `VoxShieldConnections`
- `REGION`: `us-east-1`
- `API_GATEWAY_ENDPOINT`: WebSocket API endpoint URL

## 5. Testing the Setup

### Test WebSocket Connection:
```bash
# Get WebSocket endpoint URL
WEBSOCKET_URL="wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}"

# Connect with query parameters
wscat -c "$WEBSOCKET_URL?userId=test-user&sessionId=session-123"

# Send test messages
{"type": "ping"}
{"type": "start_streaming"}
{"type": "audio_chunk", "chunkId": "1", "audioData": "base64encoded..."}
{"type": "stop_streaming"}
```

### Expected Responses:
1. Connection established:
```json
{"type": "connection_established", "connectionId": "...", "timestamp": "..."}
```

2. Pong response:
```json
{"type": "pong", "timestamp": "..."}
```

3. Streaming status:
```json
{"type": "streaming_started", "timestamp": "..."}
```

## 6. Monitoring

Set up CloudWatch Alarms for:
- WebSocket connection count
- Lambda invocation errors
- DynamoDB throttling
- API Gateway 4xx/5xx errors

## 7. Cost Optimization

To optimize costs:
1. Use PAY_PER_REQUEST for DynamoDB
2. Set appropriate Lambda memory and timeout
3. Implement connection cleanup for inactive sessions
4. Monitor and adjust WebSocket connection timeouts

## 8. Security Considerations

1. **Authentication**: Add authentication to WebSocket connections
2. **Authorization**: Validate user permissions
3. **Rate Limiting**: Implement per-connection rate limiting
4. **Input Validation**: Validate all incoming messages
5. **Encryption**: Use WSS (WebSocket Secure) only