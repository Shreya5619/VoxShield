# WebSocket Setup Guide

## Current Status
The WebSocket connection is failing because the endpoint URL is not yet configured.

## How to Fix

### Step 1: Deploy WebSocket API Gateway
If you haven't deployed the WebSocket API Gateway yet, run:

```bash
cd amplify
amplify add api
# Select: GraphQL
# Follow prompts to create API Gateway WebSocket

amplify push
```

### Step 2: Get WebSocket URL
After deployment, get the WebSocket URL:

```bash
amplify status
```

Look for the WebSocket endpoint URL in the format:
```
wss://{api-id}.execute-api.{region}.amazonaws.com/prod
```

### Step 3: Update Configuration
Edit `src/config/appConfig.ts` and update the `websocketUrl`:

```typescript
export const appConfig: AppConfig = {
  websocketUrl: 'wss://{your-api-id}.execute-api.{region}.amazonaws.com/prod',
  // ... other config
};
```

### Step 4: Test Connection
1. Start the app
2. Tap "Family Call" or "Spammer Call"
3. The WebSocket connection should now succeed

## Expected Behavior

### Success
- Connection status shows `🟢 Connected`
- Audio chunks are sent every 200ms
- Transcriptions appear in real-time
- Scam predictions are displayed

### Error Handling
The app will display helpful error messages if:
- WebSocket URL is not configured (shows setup guide)
- Network connection is lost (attempts reconnection)
- Server is busy (shows retry message)

## Current Configuration
```typescript
// src/config/appConfig.ts
websocketUrl: 'wss://your-api-gateway-url.amazonaws.com/prod' // <-- Needs to be updated
```

## Testing Without Backend
If you don't have the backend deployed yet, you can:
1. Use the "Test Streaming Performance" button to simulate the backend
2. The test will show you what the real-time streaming would look like
3. Verify all UI components are working correctly
