# AWS Transcribe Setup Script (PowerShell for Windows)
# This script automates the setup for S3-triggered transcription

$ErrorActionPreference = "Stop"

$REGION = "us-east-1"
$AUDIO_BUCKET = "voxshield"
$TABLE_NAME = "VoxShieldConnections"
$LAMBDA_ROLE_NAME = "VoxShieldTranscribeRole"
$S3_LAMBDA_NAME = "VoxShieldS3Transcribe"
$WEBSOCKET_LAMBDA_NAME = "VoxShieldWebSocketConnection"
$POLICY_NAME = "VoxShieldTranscribePolicy"

Write-Host "=========================================="
Write-Host "AWS Transcribe Setup Script (PowerShell)"
Write-Host "=========================================="

# Check AWS CLI
try {
    $null = aws --version
    Write-Host "[OK] AWS CLI found" -ForegroundColor Green
} catch {
    Write-Host "ERROR: AWS CLI not found. Please install it first." -ForegroundColor Red
    exit 1
}

# 1. Check/Create S3 bucket
Write-Host ""
Write-Host "1. Checking S3 bucket..."
$bucketExists = aws s3 ls "s3://$AUDIO_BUCKET" 2>$null
if ($bucketExists) {
    Write-Host "   [OK] Bucket $AUDIO_BUCKET already exists" -ForegroundColor Green
} else {
    Write-Host "   Creating S3 bucket: $AUDIO_BUCKET"
    aws s3 mb "s3://$AUDIO_BUCKET" --region $REGION
    Write-Host "   [OK] Bucket created" -ForegroundColor Green
}

# 2. Check/Create DynamoDB table
Write-Host ""
Write-Host "2. Checking DynamoDB table..."
$tableCheck = aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION 2>$null
if ($tableCheck) {
    Write-Host "   [OK] Table $TABLE_NAME already exists" -ForegroundColor Green
} else {
    Write-Host "   Creating DynamoDB table: $TABLE_NAME"
    aws dynamodb create-table `
        --table-name $TABLE_NAME `
        --attribute-definitions AttributeName=connectionId,AttributeType=S `
        --key-schema AttributeName=connectionId,KeyType=HASH `
        --billing-mode PAY_PER_REQUEST `
        --region $REGION
    Write-Host "   [OK] Table created" -ForegroundColor Green
}

# 3. Create IAM policy and role
Write-Host ""
Write-Host "3. Creating IAM role..."

# --- IAM Policy JSON ---
$transcribePolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Action = @("s3:GetObject", "s3:PutObject", "s3:ListBucket")
            Resource = @(
                "arn:aws:s3:::$AUDIO_BUCKET",
                "arn:aws:s3:::$AUDIO_BUCKET/*"
            )
        },
        @{
            Effect = "Allow"
            Action = @(
                "transcribe:StartTranscriptionJob",
                "transcribe:GetTranscriptionJob",
                "transcribe:ListTranscriptionJobs"
            )
            Resource = "*"
        },
        @{
            Effect = "Allow"
            Action = @(
                "dynamodb:GetItem",
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem",
                "dynamodb:Query",
                "dynamodb:Scan"
            )
            Resource = "arn:aws:dynamodb:*:*:table/$TABLE_NAME"
        },
        @{
            Effect = "Allow"
            Action = @(
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            )
            Resource = "arn:aws:logs:*:*:*"
        }
    )
}

$policyPath = Join-Path $env:TEMP "transcribe-policy.json"
$transcribePolicy | ConvertTo-Json -Depth 10 | Set-Content -Path $policyPath -Encoding utf8 -NoNewline

$existingPolicy = aws iam list-policies --query "Policies[?PolicyName=='$POLICY_NAME']" --output json 2>$null
if ($existingPolicy -and $existingPolicy.Contains($POLICY_NAME)) {
    Write-Host "   [OK] Policy $POLICY_NAME already exists" -ForegroundColor Green
} else {
    Write-Host "   Creating IAM policy: $POLICY_NAME"
    aws iam create-policy `
        --policy-name $POLICY_NAME `
        --policy-document "file://$policyPath" `
        --region $REGION
    Write-Host "   [OK] Policy created" -ForegroundColor Green
}

# --- IAM Trust Policy (for Lambda) ---
$assumeRolePolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Principal = @{ Service = "lambda.amazonaws.com" }
            Action = "sts:AssumeRole"
        }
    )
}

$trustPolicyPath = Join-Path $env:TEMP "trust-policy.json"
$assumeRolePolicy | ConvertTo-Json -Depth 10 | Set-Content -Path $trustPolicyPath -Encoding utf8 -NoNewline

$roleCheck = aws iam get-role --role-name $LAMBDA_ROLE_NAME --region $REGION 2>$null
if ($roleCheck) {
    Write-Host "   [OK] Role $LAMBDA_ROLE_NAME already exists" -ForegroundColor Green
} else {
    Write-Host "   Creating IAM role: $LAMBDA_ROLE_NAME"
    aws iam create-role `
        --role-name $LAMBDA_ROLE_NAME `
        --assume-role-policy-document "file://$trustPolicyPath" `
        --region $REGION
    Write-Host "   [OK] Role created" -ForegroundColor Green
}

# Attach policies to role
Write-Host "   Attaching policies to role..."
aws iam attach-role-policy `
    --role-name $LAMBDA_ROLE_NAME `
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" `
    --region $REGION

$policyArn = aws iam list-policies --query "Policies[?PolicyName=='$POLICY_NAME'].Arn" --output text --region $REGION
aws iam attach-role-policy `
    --role-name $LAMBDA_ROLE_NAME `
    --policy-arn $policyArn `
    --region $REGION

Write-Host "   [OK] Policies attached" -ForegroundColor Green

# 4. Get WebSocket Lambda ARN
Write-Host ""
Write-Host "4. Getting WebSocket Lambda ARN..."
$websocketLambdaArn = aws lambda get-function --function-name $WEBSOCKET_LAMBDA_NAME --query "Configuration.FunctionArn" --output text --region $REGION 2>$null
if ($websocketLambdaArn -and $websocketLambdaArn -notlike "None") {
    Write-Host "   [OK] Found WebSocket Lambda: $websocketLambdaArn" -ForegroundColor Green
} else {
    Write-Host "   [WARN] WebSocket Lambda not found. Please create it first." -ForegroundColor Yellow
    Write-Host "   Continuing with S3 Lambda setup..."
}

# 5. Create/Update S3 Transcribe Lambda
Write-Host ""
Write-Host "5. Creating S3 Transcribe Lambda function..."

# Get script directory robustly
if ($MyInvocation.MyCommand.Path) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    $scriptDir = (Get-Location).Path
}

$zipPath = Join-Path $env:TEMP "s3_transcribe_lambda.zip"
$pythonFile = Join-Path $scriptDir "s3_transcribe_lambda.py"

if (-not (Test-Path $pythonFile)) {
    Write-Host "ERROR: s3_transcribe_lambda.py not found at $pythonFile" -ForegroundColor Red
    exit 1
}

# Create deployment package (overwrite if exists)
Compress-Archive -Path $pythonFile -DestinationPath $zipPath -Force

$accountId = aws sts get-caller-identity --query "Account" --output text
$roleArn = "arn:aws:iam::$accountId`:role/$LAMBDA_ROLE_NAME"

# Try to create; if exists, update
$createOutput = aws lambda create-function `
    --function-name $S3_LAMBDA_NAME `
    --runtime python3.12 `
    --role $roleArn `
    --handler s3_transcribe_lambda.lambda_handler `
    --zip-file "fileb://$zipPath" `
    --environment "Variables={AUDIO_BUCKET=$AUDIO_BUCKET,CONNECTION_TABLE=$TABLE_NAME,OUTPUT_BUCKET=$AUDIO_BUCKET}" `
    --region $REGION `
    --timeout 30 `
    --memory-size 128 2>&1

if ($LASTEXITCODE -ne 0 -and $createOutput -match "ResourceConflictException") {
    Write-Host "   Function exists, updating..."
    aws lambda update-function-code `
        --function-name $S3_LAMBDA_NAME `
        --zip-file "fileb://$zipPath" `
        --region $REGION | Out-Null

    aws lambda update-function-configuration `
        --function-name $S3_LAMBDA_NAME `
        --environment "Variables={AUDIO_BUCKET=$AUDIO_BUCKET,CONNECTION_TABLE=$TABLE_NAME,OUTPUT_BUCKET=$AUDIO_BUCKET}" `
        --region $REGION | Out-Null

    Write-Host "   [OK] Lambda function updated" -ForegroundColor Green
} else {
    Write-Host "   [OK] Lambda function created" -ForegroundColor Green
}

# 6. Add S3 trigger (notification via console or CLI)
Write-Host ""
Write-Host "6. Adding S3 trigger..."
Write-Host "   [INFO] S3 → Lambda triggers are usually configured via S3 bucket notifications." -ForegroundColor Cyan
Write-Host "   You can either:" -ForegroundColor Cyan
Write-Host "   - Use AWS Console: S3 → $AUDIO_BUCKET → Properties → Event notifications → Add notification" -ForegroundColor Cyan
Write-Host "     • Event type: PUT" -ForegroundColor Cyan
Write-Host "     • Prefix: recordings/" -ForegroundColor Cyan
Write-Host "     • Destination: Lambda function → $S3_LAMBDA_NAME" -ForegroundColor Cyan
Write-Host "   - Or via CLI using s3api put-bucket-notification-configuration (more complex JSON)." -ForegroundColor Cyan

# Summary
Write-Host ""
Write-Host "=========================================="
Write-Host "Setup Complete!"
Write-Host "=========================================="
Write-Host ""
Write-Host "Created Resources:"
Write-Host "  - S3 Bucket: s3://$AUDIO_BUCKET"
Write-Host "  - DynamoDB Table: $TABLE_NAME"
Write-Host "  - IAM Role: $LAMBDA_ROLE_NAME"
Write-Host "  - S3 Transcribe Lambda: $S3_LAMBDA_NAME"
Write-Host ""
Write-Host "To use the transcription feature:"
Write-Host "  1. Start recording in your app"
Write-Host "  2. Audio chunks are uploaded to S3"
Write-Host "  3. S3 trigger invokes Lambda which starts Transcribe job"
Write-Host "  4. Transcription result is saved in S3"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Update your websocket Lambda code"
Write-Host "  2. Update the S3 Transcribe Lambda code if needed"
Write-Host "  3. Configure S3 bucket notification to trigger the Lambda"
Write-Host ""
Write-Host "Test by starting a recording in your app!" -ForegroundColor Green