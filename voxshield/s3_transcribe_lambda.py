import json
import boto3
import os
from datetime import datetime

s3 = boto3.client('s3')
transcribe = boto3.client('transcribe', region_name='us-east-1')
dynamodb = boto3.resource('dynamodb')

# Configuration
AUDIO_BUCKET = os.environ.get('AUDIO_BUCKET', 'voxshield')
TABLE_NAME = os.environ.get('CONNECTION_TABLE', 'VoxShieldConnections')
table = dynamodb.Table(TABLE_NAME)

def lambda_handler(event, context):
    """Handle S3 event - new audio uploaded"""
    print("Received S3 event:")
    print(json.dumps(event))
    
    try:
        # Extract S3 event details
        record = event['Records'][0]
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']
        
        print(f"Processing S3 object: s3://{bucket}/{key}")
        
        # Extract session ID from key
        # Expected format: recordings/family/session-xxx/chunk-xxx.pcm
        parts = key.split('/')
        if len(parts) < 4:
            print(f"Invalid S3 key format: {key}")
            return {'statusCode': 400}
        
        caller_type = parts[1]  # 'family' or 'spammer'
        session_id = parts[2]   # session-xxx
        
        print(f"Session ID: {session_id}, Type: {caller_type}")
        
        # Update session status
        table.update_item(
            Key={'connectionId': session_id},
            UpdateExpression='SET #s = :status, #k = :key, #u = :uploadTime',
            ExpressionAttributeNames={'#s': 'status', '#k': 'audioKey', '#u': 'uploadedAt'},
            ExpressionAttributeValues={
                ':status': 'uploading',
                ':key': key,
                ':uploadTime': datetime.utcnow().isoformat()
            },
            ConditionExpression='attribute_exists(connectionId)'
        )
        
        # Get audio sample rate from object metadata or default
        audio_key = key
        
        # Start transcription job
        job_name = f"transcription-{session_id}-{int(datetime.utcnow().timestamp())}"
        
        print(f"Starting transcription job: {job_name}")
        
        response = transcribe.start_transcription_job(
            TranscriptionJobName=job_name,
            LanguageCode='en-US',
            MediaFormat='pcm',
            Media={
                'MediaFileUri': f"s3://{AUDIO_BUCKET}/{audio_key}"
            },
            OutputBucketName=os.environ.get('OUTPUT_BUCKET', AUDIO_BUCKET),
            OutputKey=f"{audio_key}.json",
            Settings={
                'ShowSpeakerLabels': False,
                'MaxSpeakerLabels': 2,
                'ChannelIdentification': False
            }
        )
        
        print(f"Transcription job started: {job_name}")
        
        # Update session with job info
        table.update_item(
            Key={'connectionId': session_id},
            UpdateExpression='SET #s = :status, #j = :jobId, #t = :startTime',
            ExpressionAttributeNames={'#s': 'status', '#j': 'transcriptionJobId', '#t': 'jobStartedAt'},
            ExpressionAttributeValues={
                ':status': 'transcribing',
                ':jobId': job_name,
                ':startTime': datetime.utcnow().isoformat()
            }
        )
        
        # Return immediately - job will run asynchronously
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Transcription job started',
                'jobName': job_name,
                'audioKey': audio_key
            })
        }
        
    except Exception as e:
        print(f"Error processing S3 event: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
