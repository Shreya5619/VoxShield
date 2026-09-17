#!/bin/bash
# AWS Transcribe Setup Script
# This script automates the setup for S3-triggered transcription

set -e

REGION="us-east-1"
AUDIO_BUCKET="voxshield"
TABLE_NAME="VoxShieldConnections"
LAMBDA_ROLE_NAME="VoxShieldTranscribeRole"
S3_LAMBDA_NAME="VoxShieldS3Transcribe"
WEBSOCKET_LAMBDA_NAME="VoxShieldWebSocketConnection"

echo "=========================================="
echo "AWS Transcribe Setup Script"
echo "=========================================="

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo "ERROR: AWS CLI not found. Please install it first."
    exit 1
fi

# Check if S3 bucket exists
echo ""
echo "1. Checking S3 bucket..."
if aws s3 ls "s3://${AUDIO_BUCKET}" &> /dev/null; then
    echo "   ✓ Bucket ${AUDIO_BUCKET} already exists"
else
    echo "   Creating S3 bucket: ${AUDIO_BUCKET}"
    aws s3 mb "s3://${AUDIO_BUCKET}" --region ${REGION}
    echo "   ✓ Bucket created"
fi

# Check if DynamoDB table exists
echo ""
echo "2. Checking DynamoDB table..."
if aws dynamodb describe-table --table-name ${TABLE_NAME} &> /dev/null; then
    echo "   ✓ Table ${TABLE_NAME} already exists"
else
    echo "   Creating DynamoDB table: ${TABLE_NAME}"
    aws dynamodb create-table \
        --table-name ${TABLE_NAME} \
        --attribute-definitions AttributeName=connectionId,AttributeType=S \
        --key-schema AttributeName=connectionId,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        --region ${REGION}
    echo "   ✓ Table created"
fi

# Create IAM role for Lambda
echo ""
echo "3. Creating IAM role..."
POLICY_NAME="VoxShieldTranscribePolicy"

# Create the IAM policy document
cat > /tmp/transcribe-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::voxshield",
                "arn:aws:s3:::voxshield/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "transcribe:StartTranscriptionJob",
                "transcribe:GetTranscriptionJob",
                "transcribe:ListTranscriptionJobs"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "dynamodb:GetItem",
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem",
                "dynamodb:Query",
                "dynamodb:Scan"
            ],
            "Resource": "arn:aws:dynamodb:*:*:table/VoxShieldConnections"
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
EOF

# Create or update the IAM policy
if aws iam list-policies --query "Policies[?PolicyName=='${POLICY_NAME}']" --output json | grep -q "${POLICY_NAME}"; then
    echo "   ✓ Policy ${POLICY_NAME} already exists"
else
    echo "   Creating IAM policy: ${POLICY_NAME}"
    aws iam create-policy \
        --policy-name ${POLICY_NAME} \
        --policy-document file:///tmp/transcribe-policy.json \
        --region ${REGION}
    echo "   ✓ Policy created"
fi

# Create IAM role if it doesn't exist
TRUST_POLICY='{
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
}'

if aws iam get-role --role-name ${LAMBDA_ROLE_NAME} &> /dev/null; then
    echo "   ✓ Role ${LAMBDA_ROLE_NAME} already exists"
else
    echo "   Creating IAM role: ${LAMBDA_ROLE_NAME}"
    echo "${TRUST_POLICY}" > /tmp/trust-policy.json
    aws iam create-role \
        --role-name ${LAMBDA_ROLE_NAME} \
        --assume-role-policy-document file:///tmp/trust-policy.json \
        --region ${REGION}
    echo "   ✓ Role created"
fi

# Attach policies to role
echo "   Attaching policies to role..."
aws iam attach-role-policy \
    --role-name ${LAMBDA_ROLE_NAME} \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
    --region ${REGION}

POLICY_ARN=$(aws iam list-policies --query "Policies[?PolicyName=='${POLICY_NAME}'].Arn" --output text)
aws iam attach-role-policy \
    --role-name ${LAMBDA_ROLE_NAME} \
    --policy-arn ${POLICY_ARN} \
    --region ${REGION}

echo "   ✓ Policies attached"

# Get Lambda ARN for WebSocket function
echo ""
echo "4. Getting WebSocket Lambda ARN..."
WEBSOCKET_LAMBDA_ARN=$(aws lambda get-function --function-name ${WEBSOCKET_LAMBDA_NAME} --query 'Configuration.FunctionArn' --output text 2>/dev/null || echo "")
if [ -n "${WEBSOCKET_LAMBDA_ARN}" ]; then
    echo "   ✓ Found WebSocket Lambda: ${WEBSOCKET_LAMBDA_ARN}"
else
    echo "   ✗ WebSocket Lambda not found. Please create it first."
    echo "   Continuing with S3 Lambda setup..."
fi

# Create S3-triggered Transcribe Lambda
echo ""
echo "5. Creating S3 Transcribe Lambda function..."

# Create deployment package
cd $(dirname $0)
zip -r /tmp/s3_transcribe_lambda.zip s3_transcribe_lambda.py

# Create the Lambda function
aws lambda create-function \
    --function-name ${S3_LAMBDA_NAME} \
    --runtime python3.12 \
    --role arn:aws:iam::$(aws sts get-caller-identity --query 'Account' --output text):role/${LAMBDA_ROLE_NAME} \
    --handler s3_transcribe_lambda.lambda_handler \
    --zip-file fileb:///tmp/s3_transcribe_lambda.zip \
    --environment Variables="{AUDIO_BUCKET=${AUDIO_BUCKET},CONNECTION_TABLE=${TABLE_NAME},OUTPUT_BUCKET=${AUDIO_BUCKET}}" \
    --region ${REGION} \
    --timeout 30 \
    --memory-size 128 2>/dev/null || {
    # Function already exists, update it
    echo "   Function exists, updating..."
    aws lambda update-function-code \
        --function-name ${S3_LAMBDA_NAME} \
        --zip-file fileb:///tmp/s3_transcribe_lambda.zip \
        --region ${REGION}
    
    aws lambda update-function-configuration \
        --function-name ${S3_LAMBDA_NAME} \
        --environment Variables="{AUDIO_BUCKET=${AUDIO_BUCKET},CONNECTION_TABLE=${TABLE_NAME},OUTPUT_BUCKET=${AUDIO_BUCKET}}" \
        --region ${REGION}
}

echo "   ✓ Lambda function created/updated"

# Add S3 trigger
echo ""
echo "6. Adding S3 trigger..."

# Check if trigger already exists
TRIGGER_EXISTS=$(aws lambda get-event-source-mapping \
    --function-name ${S3_LAMBDA_NAME} \
    --event-source-arn "arn:aws:s3:::${AUDIO_BUCKET}" \
    --query 'UUID' \
    --output text 2>/dev/null || echo "")

if [ -n "${TRIGGER_EXISTS}" ]; then
    echo "   ✓ S3 trigger already exists"
else
    echo "   Adding S3 trigger for bucket: ${AUDIO_BUCKET}"
    aws lambda create-event-source-mapping \
        --function-name ${S3_LAMBDA_NAME} \
        --event-source-arn "arn:aws:s3:::${AUDIO_BUCKET}" \
        --events "s3:ObjectCreated:*" \
        --lambda-function-arn arn:aws:lambda:${REGION}:$(aws sts get-caller-identity --query 'Account' --output text):function:${S3_LAMBDA_NAME} \
        --region ${REGION} \
        --batch-size 1 \
        --maximum-batching-window-in-seconds 1 \
        --starting-position LATEST \
        --filter-criteria '{
            "Filters": [
                {
                    "Pattern": "{\"subject\": \"s3:ObjectCreated:*\"}"
                },
                {
                    "Pattern": "{\"detail\": {\"bucket\": {\"name\": \"'\"${AUDIO_BUCKET}\"'\"}}}"
                }
            ]
        }' 2>/dev/null || {
        # Alternative approach using console-style setup
        echo "   Note: S3 trigger requires configuration in AWS Console"
        echo "   Please go to AWS Console → Lambda → ${S3_LAMBDA_NAME} → Add trigger → S3"
        echo "   Select bucket: ${AUDIO_BUCKET}"
        echo "   Event type: PUT"
        echo "   Prefix: recordings/"
    }
fi

echo "   ✓ Trigger configured (or manual setup required)"

# Summary
echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Created Resources:"
echo "  - S3 Bucket: s3://${AUDIO_BUCKET}"
echo "  - DynamoDB Table: ${TABLE_NAME}"
echo "  - Lambda Role: ${LAMBDA_ROLE_NAME}"
echo "  - S3 Transcribe Lambda: ${S3_LAMBDA_NAME}"
echo ""
echo "To use the transcription feature:"
echo "  1. Start recording in your app"
echo "  2. Audio chunks are uploaded to S3"
echo "  3. S3 trigger invokes Lambda which starts Transcribe job"
echo "  4. Transcription result is saved in S3"
echo ""
echo "Next steps:"
echo "  1. Update your websocket_lambda.py with the new code"
echo "  2. Update the S3 Transcribe Lambda code"
echo "  3. Add S3 trigger manually if not done automatically"
echo ""
echo "Test by starting a recording in your app!"
