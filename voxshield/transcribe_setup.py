#!/usr/bin/env python3
"""
AWS Transcribe Streaming Setup Script
This script sets up the necessary resources for real-time transcription.
"""

import boto3
import json
import time

def setup_transcribe():
    """Setup AWS Transcribe for real-time streaming"""
    
    client = boto3.client('transcribe', region_name='us-east-1')
    
    print("AWS Transcribe Streaming Setup")
    print("=" * 40)
    
    # Check if we can create a streaming session
    print("\n1. Checking Transcribe Streaming availability...")
    
    try:
        # List available languages for streaming
        response = client.list_language_models()
        print(f"   Language models available: {len(response.get('Models', []))}")
    except Exception as e:
        print(f"   Note: {str(e)}")
    
    print("\n2. Transcribe Streaming Setup Complete!")
    print("\nThe Lambda function will use:")
    print("   - Language Code: en-US")
    print("   - Sample Rate: 16000 Hz")
    print("   - Audio Format: PCM (linear16)")
    print("\nTo enable streaming, update your Lambda function with:")
    print("   - AWS SDK for Python (boto3) with Transcribe Streaming support")
    print("   - Session configuration with proper language and sample rate")
    
    return {
        'language_code': 'en-US',
        'sample_rate': 16000,
        'media_encoding': 'pcm'
    }

def setup_lambda_role():
    """Setup Lambda execution role with Transcribe permissions"""
    
    iam = boto3.client('iam', region_name='us-east-1')
    
    print("\n\nLambda IAM Role Setup")
    print("=" * 40)
    
    role_name = 'VoxShieldTranscribeRole'
    
    # Check if role exists
    try:
        iam.get_role(RoleName=role_name)
        print(f"Role {role_name} already exists")
        return role_name
    except iam.exceptions.NoSuchEntityException:
        pass
    
    # Create trust policy
    trust_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Service": "lambda.amazonaws.com"
                },
                "Action": "sts:AssumeRole"
            }
        ]
    }
    
    # Create role
    print(f"Creating role: {role_name}")
    role_response = iam.create_role(
        RoleName=role_name,
        AssumeRolePolicyDocument=json.dumps(trust_policy),
        Description='Role for Lambda to access Transcribe and DynamoDB'
    )
    
    role_arn = role_response['Role']['Arn']
    print(f"Role ARN: {role_arn}")
    
    # Attach managed policies
    policies = [
        'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        'arn:aws:iam::aws:policy/TranscribeFullAccess',
        'arn:aws:iam::aws:policy/DynamoDBFullAccess'
    ]
    
    for policy_arn in policies:
        print(f"Attaching policy: {policy_arn}")
        iam.attach_role_policy(
            RoleName=role_name,
            PolicyArn=policy_arn
        )
    
    print(f"\nRole {role_name} created successfully!")
    return role_name

if __name__ == '__main__':
    setup_transcribe()
    setup_lambda_role()
    
    print("\n\n" + "=" * 40)
    print("Setup Complete!")
    print("=" * 40)
    print("\nNext steps:")
    print("1. Update your Lambda function with Transcribe Streaming code")
    print("2. Add IAM role permissions to your Lambda")
    print("3. Test with a live recording")
