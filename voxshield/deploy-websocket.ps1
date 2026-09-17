# Deploy Amplify WebSocket Lambda manually

$ErrorActionPreference = "Stop"

$REGION = "us-east-1"
$ZIP_PATH = Join-Path $env:TEMP "websocket-lambda.zip"
$FUNCTION_NAME = "websocketConnection"

Write-Host "Deploying WebSocket Lambda function..."

# Navigate to function directory
$funcDir = Join-Path $PSScriptRoot "amplify/functions/websocket-connection"
Set-Location $funcDir

# Install dependencies
Write-Host "Installing dependencies..."
npm install

# Create zip file
Write-Host "Creating deployment package..."
Compress-Archive -Path "src/*","function.json" -DestinationPath $ZIP_PATH -Force

# Get account ID and role ARN
$accountId = aws sts get-caller-identity --query "Account" --output text
$roleArn = "arn:aws:iam::$accountId`:role/websocketConnectionRole"

# Check if function exists
Write-Host "Checking if function exists..."
$functionExists = aws lambda get-function --function-name $FUNCTION_NAME --region $REGION 2>$null

if ($functionExists) {
    Write-Host "Function exists, updating code..."
    aws lambda update-function-code `
        --function-name $FUNCTION_NAME `
        --zip-file "fileb://$ZIP_PATH" `
        --region $REGION
} else {
    Write-Host "Function not found. Creating new function..."
    aws lambda create-function `
        --function-name $FUNCTION_NAME `
        --runtime nodejs20.x `
        --role $roleArn `
        --handler src/connection.handler `
        --zip-file "fileb://$ZIP_PATH" `
        --environment "Variables={CONNECTION_TABLE=VoxShieldConnections,REGION=us-east-1}" `
        --region $REGION
}

Write-Host "Deployment complete!"