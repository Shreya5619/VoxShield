# ML Prediction Pipeline Guide

This guide describes the ML prediction pipeline for VoxShield real-time scam detection.

## Overview

The ML pipeline consists of:
1. **SageMaker Endpoint**: Hosts the scikit-learn scam detection model
2. **ML Client**: Python module for calling the endpoint with caching and error handling
3. **Transcription Integration**: Lambda function that calls ML endpoint with transcribed text
4. **Deployment Script**: Automated deployment of model to SageMaker

## Architecture

```
Transcription Processing Lambda
        ↓
   ML Client Module
        ↓
SageMaker Real-time Endpoint
        ↓
   Scam Detection Model
        ↓
   Prediction Results
        ↓
WebSocket Response to Client
```

## 1. SageMaker Model Deployment

### Prerequisites
- AWS CLI configured with appropriate permissions
- SageMaker execution role ARN
- S3 bucket for model storage

### Deployment Steps

```bash
# Set environment variables
export SAGEMAKER_ROLE_ARN="arn:aws:iam::123456789012:role/SageMakerExecutionRole"
export MODEL_BUCKET="voxshield-models"

# Run deployment script
cd sagemaker-deployment
python deploy_model.py --action deploy

# Check deployment status
python deploy_model.py --action status

# Test endpoint
python deploy_model.py --action test

# Clean up (if needed)
python deploy_model.py --action delete
```

### Endpoint Configuration
- **Instance Type**: `ml.t2.medium` (for development) or `ml.c5.xlarge` (for production)
- **Model**: scikit-learn container with custom inference script
- **Auto-scaling**: Configure based on expected load

## 2. ML Client Usage

The `MLClient` class provides a unified interface for calling the SageMaker endpoint.

### Basic Usage

```python
from ml_client import MLClient, MockMLClient

# For production
client = MLClient(endpoint_name='voxshield-scam-detector')

# For testing/development (no actual endpoint calls)
client = MockMLClient()

# Single prediction
prediction = client.predict("Your car warranty is about to expire")
print(f"Is scam: {prediction.is_scam}")
print(f"Probability: {prediction.scam_probability:.2%}")
print(f"Confidence: {prediction.confidence}")

# Batch predictions
texts = [
    "This is Microsoft calling about a virus",
    "Hi mom, can you pick me up"
]
predictions = client.predict(texts)

for pred in predictions:
    print(f"{'🚫' if pred.is_scam else '✅'} {pred.text[:40]}...")
```

### Features
- **Caching**: Automatic caching of predictions to reduce API calls
- **Error Handling**: Graceful handling of endpoint errors
- **Batch Processing**: Support for batch predictions
- **Mock Client**: For local testing without AWS resources

## 3. Integration with Transcription Pipeline

The transcription processing Lambda automatically calls the ML endpoint:

```python
# In transcription-processor/lambda_function.py
def process_with_ml(connection_id: str, text: str) -> Dict[str, Any]:
    """Send text to SageMaker endpoint for scam detection."""
    # Implementation handles:
    # 1. Text validation (minimum length)
    # 2. SageMaker endpoint invocation
    # 3. Response parsing
    # 4. Error handling
    # 5. Result formatting for WebSocket
```

### Configuration
Set these environment variables in the Lambda:

```bash
SAGEMAKER_ENDPOINT_NAME=voxshield-scam-detector
MIN_CONFIDENCE_THRESHOLD=0.3  # Minimum confidence for transcription segments
TEXT_BUFFER_SIZE=5  # Number of segments to buffer before ML processing
```

## 4. Prediction Results Format

### Successful Prediction
```json
{
  "status": "success",
  "predictions": [
    {
      "text": "Your car warranty is about to expire",
      "is_scam": true,
      "scam_probability": 0.85,
      "confidence": "high",
      "model_version": "1.0.0"
    }
  ],
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Error Response
```json
{
  "status": "error",
  "error": "model_error: Endpoint not found",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## 5. Performance Considerations

### Latency Requirements
- Target: < 1 second end-to-end (audio → transcription → ML → response)
- ML inference: < 500ms
- Network overhead: < 200ms

### Caching Strategy
- Cache predictions for identical text inputs
- Cache size: 100 entries (configurable)
- LRU (Least Recently Used) eviction policy

### Batch Processing
- Process multiple texts in single API call when possible
- Default batch size: 10 texts
- Reduces API calls and improves throughput

## 6. Monitoring and Logging

### CloudWatch Metrics
- `Invocations`: Number of endpoint calls
- `ModelLatency`: Inference latency
- `InvocationErrors`: Error rate
- `CacheHitRate`: Cache effectiveness

### Logging Levels
- INFO: Prediction requests and results
- DEBUG: Cache operations, text preprocessing
- ERROR: Endpoint errors, timeouts

### Alerting
Set up CloudWatch Alarms for:
- High error rate (> 5%)
- High latency (> 1 second)
- Low cache hit rate (< 20%)

## 7. Testing the Pipeline

### Unit Tests
```bash
# Test ML client
python ml_client.py

# Test transcription processor
cd amplify/functions/transcription-processor
python test_transcription.py
```

### Integration Tests
```bash
# Deploy and test full pipeline
cd sagemaker-deployment
python deploy_model.py --action deploy
python deploy_model.py --action test

# Test with sample scam phrases
python test_scam_phrases.py
```

### Load Testing
```python
# Simulate concurrent users
import concurrent.futures
from ml_client import MLClient

client = MLClient()
phrases = load_test_phrases()  # Load 1000+ phrases

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(client.predict, phrases))
```

## 8. Troubleshooting

### Common Issues

1. **Endpoint Not Found**
   - Check endpoint name and region
   - Verify endpoint is in "InService" state
   - Check IAM permissions

2. **High Latency**
   - Check instance type (upgrade if needed)
   - Enable auto-scaling
   - Implement caching
   - Reduce batch size

3. **Model Errors**
   - Check model artifact in S3
   - Verify inference script syntax
   - Check container compatibility

4. **Cost Management**
   - Use appropriate instance type
   - Implement auto-scaling
   - Monitor usage with Cost Explorer
   - Set up budget alerts

### Debug Commands
```bash
# Check endpoint status
aws sagemaker describe-endpoint --endpoint-name voxshield-scam-detector

# View CloudWatch logs
aws logs tail /aws/lambda/transcription-processor --follow

# Check S3 model artifacts
aws s3 ls s3://voxshield-models/models/voxshield-scam-detector/

# Test endpoint directly
aws sagemaker-runtime invoke-endpoint \
  --endpoint-name voxshield-scam-detector \
  --content-type application/json \
  --body '{"text": "Test phrase"}' \
  output.json
```

## 9. Security Considerations

### IAM Permissions
- Least privilege principle for Lambda execution role
- SageMaker endpoint invocation permissions only
- S3 read access for model artifacts

### Data Privacy
- No PII (Personally Identifiable Information) in training data
- Text preprocessing to remove sensitive information
- Encrypted S3 buckets for model storage

### Network Security
- VPC configuration for SageMaker endpoint
- Security groups restricting access
- API Gateway authentication for WebSocket connections

## 10. Cost Optimization

### SageMaker Costs
- Use appropriate instance types
- Implement auto-scaling (scale to zero during off-hours)
- Use Spot Instances for development endpoints
- Monitor with AWS Cost Explorer

### Lambda Costs
- Optimize memory allocation
- Implement caching to reduce invocations
- Use provisioned concurrency for predictable loads

### Data Transfer Costs
- Minimize data transfer between services
- Use same AWS region for all services
- Compress WebSocket messages when possible