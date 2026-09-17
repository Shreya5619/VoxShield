import json
import os
import boto3
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table_name = os.environ.get('CONNECTION_TABLE', 'VoxShieldConnections')
table = dynamodb.Table(table_name)

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
        return handle_message(connection_id, event)

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
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'type': 'connection_established',
            'connectionId': connection_id,
            'userId': user_id,
            'timestamp': datetime.utcnow().isoformat()
        })
    }

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
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'type': 'disconnected',
            'connectionId': connection_id,
            'timestamp': datetime.utcnow().isoformat()
        })
    }

def handle_message(connection_id, event):
    """Handle incoming WebSocket message"""
    try:
        body = json.loads(event.get('body', '{}'))
        message_type = body.get('type', 'unknown')
        
        print(f"Message type: {message_type}")
        
        # Process different message types
        if message_type == 'ping':
            response = create_response(connection_id, {
                'type': 'pong',
                'timestamp': datetime.utcnow().isoformat()
            })
        elif message_type == 'start_streaming':
            response = create_response(connection_id, {
                'type': 'streaming_started',
                'timestamp': datetime.utcnow().isoformat(),
                'message': 'Ready to receive audio chunks'
            })
        elif message_type == 'stop_streaming':
            response = create_response(connection_id, {
                'type': 'streaming_stopped',
                'timestamp': datetime.utcnow().isoformat()
            })
        elif message_type == 'audio_chunk':
            response = create_response(connection_id, {
                'type': 'chunk_received',
                'chunkId': body.get('chunkId', 'unknown'),
                'timestamp': datetime.utcnow().isoformat()
            })
            # In production, you would forward audio chunks to Transcribe or ML service
            print(f"Received audio chunk: {body.get('chunkId')}")
        else:
            response = create_response(connection_id, {
                'type': 'error',
                'message': f'Unknown message type: {message_type}'
            })
        
        return response
        
    except json.JSONDecodeError as e:
        print(f"Invalid JSON: {str(e)}")
        return create_response(connection_id, {
            'type': 'error',
            'message': 'Invalid JSON format'
        })
    except Exception as e:
        print(f"Error handling message: {str(e)}")
        return create_response(connection_id, {
            'type': 'error',
            'message': str(e)
        })

def create_response(connection_id, response_data):
    """Send response back to WebSocket client"""
    print(f"Sending response to {connection_id}: {json.dumps(response_data)}")
    
    # Get API Gateway endpoint from environment
    api_endpoint = os.environ.get('API_GATEWAY_ENDPOINT', '')
    if not api_endpoint:
        # Construct from request context
        domain_name = os.environ.get('DOMAIN_NAME', '')
        stage = os.environ.get('STAGE', 'prod')
        api_endpoint = f"https://{domain_name}/{stage}"
    
    try:
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
        # Don't return error - just log it
    
    return {'statusCode': 200}
