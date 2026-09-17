import json
import boto3
import urllib.parse
import uuid
import base64

s3 = boto3.client("s3")
transcribe = boto3.client("transcribe")

def lambda_handler(event, context):
    print("Received event:")
    print(json.dumps(event))

    # Check if this is an S3 upload event or API Gateway event
    if "Records" in event and len(event["Records"]) > 0 and "s3" in event["Records"][0]:
        # S3 Event - process uploaded audio file
        return handle_s3_event(event)
    else:
        # API Gateway Event - audio passed in body
        return handle_api_event(event, context)

def handle_s3_event(event):
    """Handle S3 put event - audio already uploaded to S3"""
    bucket = event["Records"][0]["s3"]["bucket"]["name"]
    key = urllib.parse.unquote_plus(
        event["Records"][0]["s3"]["object"]["key"]
    )

    print(f"Bucket: {bucket}")
    print(f"File: {key}")

    job_name = f"voiceguard-{uuid.uuid4()}"
    media_uri = f"s3://{bucket}/{key}"

    print(f"Starting transcription job: {job_name}")
    print(f"Media URI: {media_uri}")

    response = transcribe.start_transcription_job(
        TranscriptionJobName=job_name,
        Media={
            "MediaFileUri": media_uri
        },
        MediaFormat="mp3",
        LanguageCode="en-US"
    )

    print("Transcription job started successfully")
    print(response)

    return {
        "statusCode": 200,
        "body": json.dumps({
            "job_name": job_name,
            "bucket": bucket,
            "key": key
        })
    }

def handle_api_event(event, context):
    """Handle API Gateway event - audio passed in request body"""
    try:
        body = json.loads(event.get("body", "{}"))
        
        # Get audio data (base64 encoded)
        audio_base64 = body.get("audio", "")
        filename = body.get("filename", f"recording-{uuid.uuid4()}.mp3")
        caller_type = body.get("callerType", "unknown")  # "family" or "spammer"
        
        # Upload to S3 bucket
        bucket_name = "voxshield"
        s3_key = f"recordings/{caller_type}/{filename}"
        
        print(f"Uploading audio to s3://{bucket_name}/{s3_key}")
        
        # Decode and upload audio
        audio_bytes = base64.b64decode(audio_base64)
        
        s3.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=audio_bytes,
            ContentType="audio/mpeg"
        )
        
        print("Audio uploaded to S3 successfully")
        
        # Start transcription job
        job_name = f"voiceguard-{uuid.uuid4()}"
        media_uri = f"s3://{bucket_name}/{s3_key}"
        
        print(f"Starting transcription job: {job_name}")
        
        transcribe_response = transcribe.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={
                "MediaFileUri": media_uri
            },
            MediaFormat="mp3",
            LanguageCode="en-US"
        )
        
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({
                "message": "Audio uploaded and transcription started",
                "s3_key": s3_key,
                "job_name": job_name,
                "caller_type": caller_type
            })
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }

def upload_audio_to_s3(audio_base64: str, caller_type: str, filename: str = None):
    """Helper function to upload audio to S3 bucket"""
    if not filename:
        filename = f"recording-{uuid.uuid4()}.mp3"
    
    bucket_name = "voxshield"
    s3_key = f"recordings/{caller_type}/{filename}"
    
    print(f"Uploading to s3://{bucket_name}/{s3_key}")
    
    # Decode and upload
    audio_bytes = base64.b64decode(audio_base64)
    
    s3.put_object(
        Bucket=bucket_name,
        Key=s3_key,
        Body=audio_bytes,
        ContentType="audio/mpeg"
    )
    
    return {
        "s3_bucket": bucket_name,
        "s3_key": s3_key,
        "media_uri": f"s3://{bucket_name}/{s3_key}"
    }
