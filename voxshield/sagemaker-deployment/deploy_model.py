#!/usr/bin/env python3
"""
SageMaker model deployment script for VoxShield scam detection.
Deploys the joblib model to a SageMaker real-time endpoint.
"""

import boto3
import os
import sys
import time
import json
import tarfile
import shutil
from datetime import datetime
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# AWS clients
sagemaker = boto3.client('sagemaker', region_name='us-east-1')
s3 = boto3.client('s3', region_name='us-east-1')

# Configuration
MODEL_NAME = 'voxshield-scam-detector'
ENDPOINT_NAME = 'voxshield-scam-detector'
ENDPOINT_CONFIG_NAME = f'{ENDPOINT_NAME}-config'
INSTANCE_TYPE = 'ml.t2.medium'  # Small instance for demo, use ml.c5.xlarge for production
INSTANCE_COUNT = 1
ROLE_ARN = os.environ.get('SAGEMAKER_ROLE_ARN', '')  # Set this environment variable
BUCKET_NAME = os.environ.get('MODEL_BUCKET', 'voxshield-models')
MODEL_PATH = '../model/voiceguard_scam_model.joblib'
INFERENCE_CODE_PATH = '../model/inference.py'
REQUIREMENTS_PATH = '../model/requirements.txt'

def create_model_tarball():
    """Create a tarball with model and inference code for SageMaker."""
    logger.info("Creating model tarball...")
    
    # Create temporary directory
    temp_dir = 'model_tarball'
    os.makedirs(temp_dir, exist_ok=True)
    
    try:
        # Copy model file
        shutil.copy(MODEL_PATH, os.path.join(temp_dir, 'voiceguard_scam_model.joblib'))
        
        # Copy inference script
        shutil.copy(INFERENCE_CODE_PATH, os.path.join(temp_dir, 'inference.py'))
        
        # Copy requirements
        shutil.copy(REQUIREMENTS_PATH, os.path.join(temp_dir, 'requirements.txt'))
        
        # Create tarball
        tarball_path = 'model.tar.gz'
        with tarfile.open(tarball_path, 'w:gz') as tar:
            tar.add(temp_dir, arcname='.')
        
        logger.info(f"Created tarball: {tarball_path}")
        return tarball_path
        
    finally:
        # Clean up temporary directory
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

def upload_model_to_s3(tarball_path, bucket_name, s3_key):
    """Upload model tarball to S3."""
    logger.info(f"Uploading model to s3://{bucket_name}/{s3_key}")
    
    try:
        s3.upload_file(tarball_path, bucket_name, s3_key)
        logger.info("Model uploaded successfully")
        
        # Get S3 URI
        s3_uri = f's3://{bucket_name}/{s3_key}'
        return s3_uri
        
    except Exception as e:
        logger.error(f"Error uploading model to S3: {e}")
        raise

def create_model_in_sagemaker(model_name, s3_uri, role_arn):
    """Create model in SageMaker."""
    logger.info(f"Creating SageMaker model: {model_name}")
    
    try:
        response = sagemaker.create_model(
            ModelName=model_name,
            PrimaryContainer={
                'Image': '763104351884.dkr.ecr.us-east-1.amazonaws.com/sklearn:1.2-1-cpu-py3',
                'Mode': 'SingleModel',
                'ModelDataUrl': s3_uri,
                'Environment': {
                    'SAGEMAKER_PROGRAM': 'inference.py',
                    'SAGEMAKER_SUBMIT_DIRECTORY': '/opt/ml/model/code'
                }
            },
            ExecutionRoleArn=role_arn
        )
        
        logger.info(f"Model created: {model_name}")
        return response
        
    except sagemaker.exceptions.ClientError as e:
        if e.response['Error']['Code'] == 'ResourceLimitExceeded':
            logger.error("Resource limit exceeded. Check your SageMaker limits.")
            raise
        elif e.response['Error']['Code'] == 'ConflictException':
            logger.warning(f"Model {model_name} already exists")
            return {'ModelArn': f'arn:aws:sagemaker:us-east-1:xxx:model/{model_name}'}
        else:
            logger.error(f"Error creating model: {e}")
            raise

def create_endpoint_config(endpoint_config_name, model_name, instance_type, instance_count):
    """Create endpoint configuration."""
    logger.info(f"Creating endpoint configuration: {endpoint_config_name}")
    
    try:
        response = sagemaker.create_endpoint_config(
            EndpointConfigName=endpoint_config_name,
            ProductionVariants=[
                {
                    'VariantName': 'AllTraffic',
                    'ModelName': model_name,
                    'InitialInstanceCount': instance_count,
                    'InstanceType': instance_type,
                    'InitialVariantWeight': 1.0
                }
            ]
        )
        
        logger.info(f"Endpoint configuration created: {endpoint_config_name}")
        return response
        
    except sagemaker.exceptions.ClientError as e:
        if e.response['Error']['Code'] == 'ConflictException':
            logger.warning(f"Endpoint config {endpoint_config_name} already exists")
            return {'EndpointConfigArn': f'arn:aws:sagemaker:us-east-1:xxx:endpoint-config/{endpoint_config_name}'}
        else:
            logger.error(f"Error creating endpoint config: {e}")
            raise

def create_endpoint(endpoint_name, endpoint_config_name):
    """Create SageMaker endpoint."""
    logger.info(f"Creating endpoint: {endpoint_name}")
    
    try:
        response = sagemaker.create_endpoint(
            EndpointName=endpoint_name,
            EndpointConfigName=endpoint_config_name
        )
        
        logger.info(f"Endpoint creation started: {endpoint_name}")
        return response
        
    except sagemaker.exceptions.ClientError as e:
        if e.response['Error']['Code'] == 'ConflictException':
            logger.warning(f"Endpoint {endpoint_name} already exists")
            return update_endpoint(endpoint_name, endpoint_config_name)
        else:
            logger.error(f"Error creating endpoint: {e}")
            raise

def update_endpoint(endpoint_name, endpoint_config_name):
    """Update existing endpoint."""
    logger.info(f"Updating endpoint: {endpoint_name}")
    
    try:
        response = sagemaker.update_endpoint(
            EndpointName=endpoint_name,
            EndpointConfigName=endpoint_config_name
        )
        
        logger.info(f"Endpoint update started: {endpoint_name}")
        return response
        
    except Exception as e:
        logger.error(f"Error updating endpoint: {e}")
        raise

def wait_for_endpoint(endpoint_name, max_wait_minutes=30):
    """Wait for endpoint to be ready."""
    logger.info(f"Waiting for endpoint {endpoint_name} to be ready...")
    
    start_time = time.time()
    max_wait_seconds = max_wait_minutes * 60
    
    while True:
        try:
            response = sagemaker.describe_endpoint(EndpointName=endpoint_name)
            status = response['EndpointStatus']
            
            logger.info(f"Endpoint status: {status}")
            
            if status == 'InService':
                logger.info("✅ Endpoint is ready!")
                return True
            elif status == 'Failed':
                logger.error("❌ Endpoint creation failed")
                failure_reason = response.get('FailureReason', 'Unknown')
                logger.error(f"Failure reason: {failure_reason}")
                return False
            elif status == 'Creating' or status == 'Updating':
                # Still working, wait and check again
                elapsed = time.time() - start_time
                if elapsed > max_wait_seconds:
                    logger.error(f"❌ Endpoint creation timed out after {max_wait_minutes} minutes")
                    return False
                
                time.sleep(30)  # Wait 30 seconds before checking again
            else:
                logger.warning(f"Unexpected status: {status}")
                time.sleep(30)
                
        except Exception as e:
            logger.error(f"Error checking endpoint status: {e}")
            time.sleep(30)

def test_endpoint(endpoint_name):
    """Test the deployed endpoint."""
    logger.info(f"Testing endpoint: {endpoint_name}")
    
    # Create SageMaker runtime client
    runtime = boto3.client('sagemaker-runtime', region_name='us-east-1')
    
    # Test with scam phrases
    test_phrases = [
        "Your social security number has been compromised",
        "This is Microsoft calling about a virus on your computer",
        "You owe back taxes to the IRS",
        "Hi mom, can you pick me up from school",
        "What are you doing for dinner tonight"
    ]
    
    results = []
    for phrase in test_phrases:
        try:
            response = runtime.invoke_endpoint(
                EndpointName=endpoint_name,
                ContentType='application/json',
                Body=json.dumps({'text': phrase})
            )
            
            result = json.loads(response['Body'].read().decode('utf-8'))
            results.append((phrase, result))
            
            logger.info(f"Test phrase: '{phrase}'")
            logger.info(f"Result: {json.dumps(result, indent=2)}")
            
        except Exception as e:
            logger.error(f"Error testing phrase '{phrase}': {e}")
            results.append((phrase, {'error': str(e)}))
    
    return results

def deploy_model():
    """Main deployment function."""
    logger.info("=" * 60)
    logger.info("VoxShield SageMaker Model Deployment")
    logger.info("=" * 60)
    
    # Check required environment variables
    if not ROLE_ARN:
        logger.error("❌ SAGEMAKER_ROLE_ARN environment variable not set")
        logger.info("Please set SAGEMAKER_ROLE_ARN to your SageMaker execution role ARN")
        return False
    
    try:
        # Step 1: Create model tarball
        tarball_path = create_model_tarball()
        
        # Step 2: Upload to S3
        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        s3_key = f'models/{MODEL_NAME}/{timestamp}/model.tar.gz'
        s3_uri = upload_model_to_s3(tarball_path, BUCKET_NAME, s3_key)
        
        # Step 3: Create SageMaker model
        create_model_in_sagemaker(MODEL_NAME, s3_uri, ROLE_ARN)
        
        # Step 4: Create endpoint configuration
        create_endpoint_config(ENDPOINT_CONFIG_NAME, MODEL_NAME, INSTANCE_TYPE, INSTANCE_COUNT)
        
        # Step 5: Create endpoint
        create_endpoint(ENDPOINT_NAME, ENDPOINT_CONFIG_NAME)
        
        # Step 6: Wait for endpoint to be ready
        if not wait_for_endpoint(ENDPOINT_NAME):
            return False
        
        # Step 7: Test endpoint
        test_results = test_endpoint(ENDPOINT_NAME)
        
        # Clean up tarball
        if os.path.exists(tarball_path):
            os.remove(tarball_path)
        
        logger.info("=" * 60)
        logger.info("✅ Deployment completed successfully!")
        logger.info(f"Endpoint name: {ENDPOINT_NAME}")
        logger.info(f"Instance type: {INSTANCE_TYPE}")
        logger.info(f"Tested {len(test_results)} phrases")
        logger.info("=" * 60)
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Deployment failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def get_endpoint_status(endpoint_name):
    """Get current endpoint status."""
    try:
        response = sagemaker.describe_endpoint(EndpointName=endpoint_name)
        return {
            'status': response['EndpointStatus'],
            'creation_time': response.get('CreationTime'),
            'last_modified_time': response.get('LastModifiedTime'),
            'endpoint_arn': response['EndpointArn']
        }
    except Exception as e:
        logger.error(f"Error getting endpoint status: {e}")
        return {'error': str(e)}

def delete_endpoint(endpoint_name):
    """Delete endpoint."""
    logger.info(f"Deleting endpoint: {endpoint_name}")
    
    try:
        sagemaker.delete_endpoint(EndpointName=endpoint_name)
        logger.info(f"Endpoint deletion started: {endpoint_name}")
        return True
    except Exception as e:
        logger.error(f"Error deleting endpoint: {e}")
        return False

if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Deploy VoxShield model to SageMaker')
    parser.add_argument('--action', choices=['deploy', 'status', 'delete', 'test'], 
                       default='deploy', help='Action to perform')
    parser.add_argument('--endpoint-name', default=ENDPOINT_NAME, 
                       help='SageMaker endpoint name')
    
    args = parser.parse_args()
    
    if args.action == 'deploy':
        success = deploy_model()
        sys.exit(0 if success else 1)
    elif args.action == 'status':
        status = get_endpoint_status(args.endpoint_name)
        print(json.dumps(status, indent=2, default=str))
    elif args.action == 'delete':
        success = delete_endpoint(args.endpoint_name)
        sys.exit(0 if success else 1)
    elif args.action == 'test':
        results = test_endpoint(args.endpoint_name)
        for phrase, result in results:
            print(f"\nPhrase: {phrase}")
            print(f"Result: {json.dumps(result, indent=2)}")