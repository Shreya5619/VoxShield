import json
import os
import boto3
from datetime import datetime
import asyncio

dynamodb = boto3.resource('dynamodb')
table_name = os.environ.get('CONNECTION_TABLE', 'VoxShieldConnections')
table = dynamodb.Table(table_name)
transcribe = boto3.client('transcribe', region_name='us-east-1')

def lambda_handler(event, context):
    """Handle WebSocket API Gateway events"""
    print("Received event:")
    print(json.dumps(event))
    
    # Get connection info
    request_context = event.get('requestContext', {})
    connection_id = request_context.get('connectionId')
    route_key = request_context.get('routeKey', '$default')
    
    print(f"Connection: {connection_id}, Route: {route_key}")
    
    if route_key == '$connect':
        return handle_connect(connection_id, event)
    elif route_key == '$disconnect':
        return handle_disconnect(connection_id)
    else:
        # $default route - process incoming messages
        handle_message_no_response(connection_id, event, context)
        # Return immediately without waiting for response
        return {'statusCode': 200}

def handle_connect(connection_id, event):
    """Handle new WebSocket connection"""
    print(f"New connection: {connection_id}")
    
    # Extract query parameters
    query_params = event.get('queryStringParameters', {})
    user_id = query_params.get('userId', 'anonymous')
    session_id = query_params.get('sessionId', connection_id)
    
    # Save connection to DynamoDB
    try:
        table.put_item(
            Item={
                'connectionId': connection_id,
                'userId': user_id,
                'sessionId': session_id,
                'createdAt': datetime.utcnow().isoformat(),
                'lastActive': datetime.utcnow().isoformat()
            }
        )
        print(f"Saved connection {connection_id} for user {user_id}")
    except Exception as e:
        print(f"Error saving connection: {str(e)}")
    
    # Send connection established response
    send_response_async(connection_id, event, {
        'type': 'connection_established',
        'connectionId': connection_id,
        'userId': user_id,
        'timestamp': datetime.utcnow().isoformat()
    })
    
    return {'statusCode': 200}

def handle_disconnect(connection_id):
    """Handle WebSocket disconnection"""
    print(f"Disconnecting: {connection_id}")
    
    try:
        table.delete_item(
            Key={'connectionId': connection_id}
        )
        print(f"Removed connection {connection_id}")
    except Exception as e:
        print(f"Error removing connection: {str(e)}")
    
    return {'statusCode': 200}

def handle_message_no_response(connection_id, event, context):
    """Handle incoming WebSocket message without blocking"""
    try:
        print(f"handle_message called with connection_id: {connection_id}")
        
        body = json.loads(event.get('body', '{}'))
        message_type = body.get('type', 'unknown')
        
        print(f"Message type: {message_type}")
        
        # Process different message types
        if message_type == 'ping':
            print("Processing ping message")
            send_response_async(connection_id, event, {
                'type': 'pong',
                'timestamp': datetime.utcnow().isoformat()
            })
        elif message_type == 'start_streaming':
            print("Processing start_streaming message")
            start_transcription_stream(connection_id, event, body)
            send_response_async(connection_id, event, {
                'type': 'streaming_started',
                'timestamp': datetime.utcnow().isoformat(),
                'message': 'Ready to receive audio chunks'
            })
        elif message_type == 'stop_streaming':
            print("Processing stop_streaming message")
            stop_transcription_stream(connection_id, event)
            send_response_async(connection_id, event, {
                'type': 'streaming_stopped',
                'timestamp': datetime.utcnow().isoformat()
            })
        elif message_type == 'audio_chunk':
            print(f"Received audio chunk: {body.get('chunkId')}")
            # Forward audio chunk to transcription
            forward_audio_chunk(connection_id, event, body)
        else:
            print(f"Unknown message type: {message_type}")
            send_response_async(connection_id, event, {
                'type': 'error',
                'message': f'Unknown message type: {message_type}'
            })
            
    except json.JSONDecodeError as e:
        print(f"Invalid JSON: {str(e)}")
    except Exception as e:
        print(f"Error handling message: {str(e)}")

def start_transcription_stream(connection_id, event, message_body):
    """Start a new transcription stream"""
    try:
        # Get streaming parameters
        session_id = message_body.get('data', {}).get('sessionId', 'default')
        language_code = 'en-US'
        sample_rate = message_body.get('data', {}).get('sampleRate', 16000)
        
        print(f"Starting transcription stream for session: {session_id}")
        
        # Start transcription stream
        response = transcribe.start_streaming_transcription(
            LanguageCode=language_code,
            MediaEncoding='pcm',
            SampleRate=sample_rate,
            AudioStream={
                'Body': None  # We'll send chunks separately
            }
        )
        
        print(f"Transcription stream started: {response}")
        
        # Store stream details in DynamoDB
        table.update_item(
            Key={'connectionId': connection_id},
            UpdateExpression='SET transcriptionStreamId = :sid',
            ExpressionAttributeValues={':sid': response.get('TranscriptionStreamId', session_id)}
        )
        
    except Exception as e:
        print(f"Error starting transcription stream: {str(e)}")
        send_response_async(connection_id, event, {
            'type': 'transcription_error',
            'message': str(e)
        })

def stop_transcription_stream(connection_id, event):
    """Stop the current transcription stream"""
    try:
        # Get stream ID from DynamoDB
        response = table.get_item(Key={'connectionId': connection_id})
        stream_id = response.get('Item', {}).get('transcriptionStreamId')
        
        if stream_id:
            print(f"Stopping transcription stream: {stream_id}")
            # In production, you would stop the stream here
        else:
            print("No active transcription stream found")
            
    except Exception as e:
        print(f"Error stopping transcription stream: {str(e)}")

def forward_audio_chunk(connection_id, event, message_body):
    """Forward audio chunk to transcription service"""
    try:
        # Get the audio data (base64 encoded PCM)
        audio_data = message_body.get('audioData', '')
        chunk_id = message_body.get('chunkId', '')
        
        if audio_data:
            print(f"Forwarding audio chunk {chunk_id} to transcription")
            
            # In production, you would send the audio data to the transcription stream
            # For now, we'll just log it
            # audio_bytes = base64.b64decode(audio_data)
            # stream.write(audio_bytes)
            
    except Exception as e:
        print(f"Error forwarding audio chunk: {str(e)}")

def send_response_async(connection_id, event, response_data):
    """Send response back to WebSocket client in a separate thread"""
    import threading
    
    def send():
        try:
            request_context = event.get('requestContext', {})
            domain_name = request_context.get('domainName', '')
            stage = request_context.get('stage', 'prod')
            
            if not domain_name:
                print(f"ERROR: domainName not found in request context")
                return
            
            api_endpoint = f"https://{domain_name}/{stage}"
            print(f"Sending response to {connection_id} via {api_endpoint}")
            
            # Use apigatewaymanagementapi to send response
            api_gateway_client = boto3.client('apigatewaymanagementapi', 
                endpoint_url=api_endpoint)
            
            api_gateway_client.post_to_connection(
                ConnectionId=connection_id,
                Data=json.dumps(response_data).encode('utf-8')
            )
            print(f"Successfully sent response to {connection_id}")
            
        except Exception as e:
            print(f"Error sending response: {str(e)}")
    
    # Start in a new thread to not block Lambda
    thread = threading.Thread(target=send)
    thread.daemon = True
    thread.start()
