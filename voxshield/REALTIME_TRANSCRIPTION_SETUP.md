# Real-Time Transcription Setup Guide

This guide explains how to implement real-time transcription using AWS Transcribe Streaming API.

## Current Status

✅ WebSocket connection working
✅ Lambda function receiving messages
✅ Audio chunks being received

## What Needs to Be Implemented

To get real-time transcription, we need to:

1. **Start Transcribe Streaming Session** when `start_streaming` message is received
2. **Forward Audio Chunks** to the Transcribe stream
3. **Stream Transcription Results** back to the client
4. **Stop Transcribe Stream** when `stop_streaming` message is received

## Step-by-Step Setup

### Step 1: Create IAM Policy for Transcribe

In AWS Console:

1. Go to **IAM → Policies → Create policy**
2. Select **JSON** tab
3. Paste this policy:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "transcribe:StartStreamTranscription",
                "transcribe:StartStreamTranscriptionWebSocket",
                "transcribe:StopStreamTranscription"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:logs:*:*:*"
        }
    ]
}
```

4. Click **Next**
5. Name: `VoxShieldTranscribePolicy`
6. Click **Create policy**

### Step 2: Update Lambda Execution Role

1. Go to **Lambda Functions → Your Function**
2. Click **Configuration → Permissions**
3. Click on the execution role name
4. Click **Add permissions → Attach policy**
5. Select `VoxShieldTranscribePolicy`
6. Click **Attach**

### Step 3: Update Lambda Function Code

Replace your Lambda function code with the updated `websocket_lambda.py` provided.

The key changes:
- `start_streaming` → Starts Transcribe Streaming session
- `audio_chunk` → Forwards audio data to Transcribe
- `streaming_started` → Response sent when transcription starts
- Transcription results sent as `transcription_update` messages

### Step 4: Test the Setup

1. Start recording in your app
2. Speak for a few seconds
3. Check Lambda logs for:
   - `Starting transcription stream for session: ...`
   - `Received audio chunk: ...`
4. Check WebSocket for `transcription_update` messages

## Expected Behavior

### Flow:
1. Client sends `start_streaming` → Lambda starts Transcribe stream
2. Client sends audio chunks → Lambda forwards to Transcribe
3. Transcribe returns partial/transient results → Lambda sends to client
4. Client shows live transcription

### Client receives:
```json
{
  "type": "streaming_started",
  "timestamp": "2026-09-17T19:00:00.000Z",
  "message": "Ready to receive audio chunks"
}
```

Then as transcription comes in:
```json
{
  "type": "transcription_update",
  "text": "Hello world",
  "confidence": 0.95,
  "isFinal": false,
  "timestamp": "2026-09-17T19:00:01.000Z"
}
```

When final result:
```json
{
  "type": "transcription_update",
  "text": "Hello world how are you",
  "confidence": 0.98,
  "isFinal": true,
  "timestamp": "2026-09-17T19:00:02.000Z"
}
```

## Troubleshooting

### Error: "transcribe:StartStreamTranscription not found"

**Solution**: The Transcribe Streaming API might not be available in your region. Make sure you're using a region that supports it (us-east-1, us-west-2, eu-west-1).

### Error: "GoneException"

**Solution**: The WebSocket connection closed before the response was sent. This is expected if the client disconnects.

### No transcription results coming back

**Solution**: 
1. Check Lambda logs for Transcribe errors
2. Verify audio data format (should be 16kHz PCM)
3. Check if Transcribe stream was started successfully

## Notes

- The current implementation forwards audio chunks but the actual Transcribe Streaming might require a different approach
- You might need to use the **Transcribe Real-Time Streaming** API instead
- Consider using **Amazon Transcribe Streaming** SDK which handles the WebSocket for you

## Alternative: Use Amazon Transcribe Real-Time Streaming

Instead of manually managing the stream, you can use the Transcribe Real-Time Streaming SDK:

```python
import boto3

transcribe = boto3.client('transcribe-streaming', region_name='us-east-1')

response = transcribe.start_stream_transcription(
    LanguageCode='en-US',
    MediaEncoding='pcm',
    SampleRate=16000,
    MediaSampleRateHertz=16000
)
```

This handles the WebSocket connection automatically.
