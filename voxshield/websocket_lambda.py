import json
import os
import boto3
from datetime import datetime
import uuid

s3 = boto3.client('s3')
transcribe = boto3.client('transcribe', region_name='us-east-1')
dynamodb = boto3.resource('dynamodb')
table_name = os.environ.get('CONNECTION_TABLE', 'VoxShieldConnections')
table = dynamodb.Table(table_name)

# Configuration
AUDIO_BUCKET = os.environ.get('AUDIO_BUCKET', 'voxshield')
AUDIO_PREFIX = 'recordings'
TRANSCRIPTION_PREFIX = 'transcriptions'

def lambda_handler(event, context):
    """Handle WebSocket API Gateway events"""
    print("Received event:")
    print(json.dumps(event))
    
    request_context = event.get('requestContext', {})
    connection_id = request_context.get('connectionId')
    route_key = request_context.get('routeKey', '$default')
    
    print(f"Connection: {connection_id}, Route: {route_key}")
    
    if route_key == '$connect':
        return handle_connect(connection_id, event)
    elif route_key == '$disconnect':
        return handle_disconnect(connection_id)
    else:
        return handle_message(connection_id, event)

def handle_connect(connection_id, event):
    """Handle new WebSocket connection"""
    print(f"New connection: {connection_id}")
    
    query_params = event.get('queryStringParameters', {})
    user_id = query_params.get('userId', 'anonymous')
    session_id = query_params.get('sessionId', connection_id)
    
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
    
    send_response(connection_id, event, {
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
        table.delete_item(Key={'connectionId': connection_id})
        print(f"Removed connection {connection_id}")
    except Exception as e:
        print(f"Error removing connection: {str(e)}")
    
    return {'statusCode': 200}

def handle_message(connection_id, event):
    """Handle incoming WebSocket message"""
    try:
        body = json.loads(event.get('body', '{}'))
        message_type = body.get('type', 'unknown')
        
        print(f"Message type: {message_type}")
        
        if message_type == 'ping':
            send_response(connection_id, event, {
                'type': 'pong',
                'timestamp': datetime.utcnow().isoformat()
            })
            return {'statusCode': 200}
        elif message_type == 'start_streaming':
            return start_transcription(connection_id, event, body)
        elif message_type == 'stop_streaming':
            return stop_transcription(connection_id, event)
        elif message_type == 'audio_chunk':
            return handle_audio_chunk(connection_id, event, body)
        else:
            send_response(connection_id, event, {
                'type': 'error',
                'message': f'Unknown message type: {message_type}'
            })
            return {'statusCode': 200}
            
    except json.JSONDecodeError as e:
        print(f"Invalid JSON: {str(e)}")
        send_response(connection_id, event, {
            'type': 'error',
            'message': 'Invalid JSON format'
        })
        return {'statusCode': 200}

def start_transcription(connection_id, event, message_body):
    """Start a new transcription session"""
    try:
        session_id = message_body.get('data', {}).get('sessionId', f"session-{uuid.uuid4()}")
        caller_type = message_body.get('data', {}).get('callerType', 'unknown')
        
        print(f"Starting transcription session: {session_id}, type: {caller_type}")
        
        # Store session details in DynamoDB
        table.put_item(
            Item={
                'connectionId': connection_id,
                'sessionId': session_id,
                'callerType': caller_type,
                'createdAt': datetime.utcnow().isoformat(),
                'status': 'started',
                'transcriptionJobId': None,
                'transcriptionText': ''
            }
        )
        
        send_response(connection_id, event, {
            'type': 'streaming_started',
            'timestamp': datetime.utcnow().isoformat(),
            'message': f'Audio upload session started for {caller_type}'
        })
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'type': 'streaming_started',
                'timestamp': datetime.utcnow().isoformat(),
                'message': f'Audio upload session started for {caller_type}'
            })
        }
        
    except Exception as e:
        print(f"Error starting transcription: {str(e)}")
        send_response(connection_id, event, {
            'type': 'error',
            'message': str(e)
        })
        return {
            'statusCode': 500,
            'body': json.dumps({
                'type': 'error',
                'message': str(e)
            })
        }

def stop_transcription(connection_id, event):
    """Stop transcription session and start batch job"""
    try:
        # Get session details
        response = table.get_item(Key={'connectionId': connection_id})
        session_id = response.get('Item', {}).get('sessionId')
        
        if not session_id:
            send_response(connection_id, event, {
                'type': 'error',
                'message': 'No active transcription session'
            })
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'type': 'error',
                    'message': 'No active transcription session'
                })
            }
        
        print(f"Stopping transcription session: {session_id}")
        
        # Update session status
        table.update_item(
            Key={'connectionId': connection_id},
            UpdateExpression='SET #s = :status, #t = :timestamp',
            ExpressionAttributeNames={'#s': 'status', '#t': 'completedAt'},
            ExpressionAttributeValues={':status': 'completed', ':timestamp': datetime.utcnow().isoformat()}
        )
        
        send_response(connection_id, event, {
            'type': 'streaming_stopped',
            'timestamp': datetime.utcnow().isoformat(),
            'message': f'Session {session_id} completed'
        })
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'type': 'streaming_stopped',
                'timestamp': datetime.utcnow().isoformat(),
                'message': f'Session {session_id} completed'
            })
        }
        
    except Exception as e:
        print(f"Error stopping transcription: {str(e)}")
        send_response(connection_id, event, {
            'type': 'error',
            'message': str(e)
        })
        return {
            'statusCode': 500,
            'body': json.dumps({
                'type': 'error',
                'message': str(e)
            })
        }

def handle_audio_chunk(connection_id, event, message_body):
    """Upload audio chunk to S3"""
    try:
        audio_data = message_body.get('audioData', '')
        chunk_id = message_body.get('chunkId', '')
        
        if not audio_data:
            print("No audio data in chunk")
            return {'statusCode': 200}
        
        # Get session details
        response = table.get_item(Key={'connectionId': connection_id})
        session_id = response.get('Item', {}).get('sessionId')
        caller_type = response.get('Item', {}).get('callerType', 'unknown')
        
        if not session_id:
            print("No active session for connection")
            return {'statusCode': 200}
        
        # Decode and upload audio
        audio_bytes = base64.b64decode(audio_data)
        
        # Generate S3 key
        s3_key = f"{AUDIO_PREFIX}/{caller_type}/{session_id}/{chunk_id}.pcm"
        
        # Upload to S3
        s3.put_object(
            Bucket=AUDIO_BUCKET,
            Key=s3_key,
            Body=audio_bytes,
            ContentType='audio/pcm'
        )
        
        print(f"Uploaded audio chunk {chunk_id} to s3://{AUDIO_BUCKET}/{s3_key}")
        
        return {'statusCode': 200}
        
    except Exception as e:
        print(f"Error handling audio chunk: {str(e)}")
        send_response(connection_id, event, {
            'type': 'error',
            'message': str(e)
        })
        return {
            'statusCode': 500,
            'body': json.dumps({
                'type': 'error',
                'message': str(e)
            })
        }

def send_response(connection_id, event, response_data):
    """Send response back to WebSocket client"""
    try:
        request_context = event.get('requestContext', {})
        domain_name = request_context.get('domainName', '')
        stage = request_context.get('stage', 'prod')
        
        if not domain_name:
            print(f"ERROR: domainName not found")
            return
        
        api_endpoint = f"https://{domain_name}/{stage}"
        print(f"Sending response to {connection_id}")
        
        api_gateway_client = boto3.client('apigatewaymanagementapi', endpoint_url=api_endpoint)
        
        api_gateway_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(response_data).encode('utf-8')
        )
        
    except Exception as e:
        print(f"Error sending response: {str(e)}")
