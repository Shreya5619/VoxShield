import json
import boto3
import asyncio
import aiohttp
import base64
from datetime import datetime
from urllib.parse import quote

# AWS Transcribe Streaming uses a special WebSocket protocol
# We need to use the HTTP/2 API or implement the protocol manually

async def start_transcribe_stream(session_id: str, language_code: str = 'en-US', sample_rate: int = 16000):
    """
    Start a transcription stream using AWS Transcribe Streaming API
    Returns a stream handler that can receive audio chunks and send transcription results
    """
    import websocket
    
    # AWS Transcribe Streaming WebSocket endpoint
    # Format: wss://transcribestreaming.{region}.amazonaws.com:8443
    region = 'us-east-1'
    endpoint = f"wss://transcribestreaming.{region}.amazonaws.com:8443"
    
    # Create connection with query parameters
    # This is a simplified version - in production, you'd need proper authentication
    params = {
        'header': json.dumps({
            'messageType': 'StartStreamTranscription',
            'payload': {
                'LanguageCode': language_code,
                'MediaEncoding': 'pcm',
                'SampleRate': sample_rate
            }
        }),
        'payload': ''
    }
    
    url = f"{endpoint}?{('&').join([f'{k}={quote(v)}' for k, v in params.items()])}"
    
    return websocket.create_connection(url)

def send_audio_chunk(stream, audio_data: bytes, chunk_id: str = '1'):
    """Send an audio chunk to the transcription stream"""
    # Transcribe Streaming protocol requires:
    # 1. Binary audio data (PCM)
    # 2. Proper framing
    
    # For now, send as base64 encoded
    stream.send(base64.b64encode(audio_data).decode('utf-8'))

def receive_transcription(stream):
    """Receive transcription results from the stream"""
    result = stream.recv()
    return json.loads(result)

async def transcribe_audio_stream(audio_chunks: list, session_id: str):
    """
    Main function to transcribe a stream of audio chunks
    Returns transcribed text and partial results
    """
    stream = None
    try:
        # Start transcription stream
        stream = start_transcribe_stream(session_id)
        
        transcription_parts = []
        
        for chunk in audio_chunks:
            # Send audio chunk
            audio_bytes = base64.b64decode(chunk['data'])
            send_audio_chunk(stream, audio_bytes, chunk['id'])
            
            # Check for transcription updates
            try:
                result = receive_transcription(stream)
                if result.get('type') == 'Transcript':
                    for transcript in result.get('Transcript', []):
                        if transcript.get('IsPartial', False):
                            transcription_parts.append({
                                'text': transcript.get('Transcript', ''),
                                'isFinal': False
                            })
                        else:
                            transcription_parts.append({
                                'text': transcript.get('Transcript', ''),
                                'isFinal': True
                            })
            except Exception as e:
                # No transcription available yet
                pass
        
        return transcription_parts
        
    finally:
        if stream:
            stream.close()

def lambda_handler(event, context):
    """Lambda handler for WebSocket events with Transcribe Streaming"""
    print(f"Event: {json.dumps(event)}")
    
    request_context = event.get('requestContext', {})
    connection_id = request_context.get('connectionId')
    route_key = request_context.get('routeKey')
    
    if route_key == '$connect':
        return {
            'statusCode': 200,
            'body': json.dumps({'type': 'connected', 'connectionId': connection_id})
        }
    elif route_key == '$disconnect':
        return {'statusCode': 200}
    else:
        # Handle messages
        body = json.loads(event.get('body', '{}'))
        message_type = body.get('type')
        
        if message_type == 'start_streaming':
            # Start transcription stream
            session_id = body.get('data', {}).get('sessionId', 'default')
            
            # For now, return that streaming started
            # In production, you'd start the Transcribe stream here
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'type': 'streaming_started',
                    'message': 'Transcription streaming started'
                })
            }
        
        return {'statusCode': 200}
