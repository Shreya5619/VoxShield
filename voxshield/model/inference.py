#!/usr/bin/env python3
"""
SageMaker inference script for VoxShield scam detection model.
This script loads the joblib model and provides a predict function for real-time inference.
"""

import joblib
import numpy as np
import json
import os
import sys
import logging

# Set up logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

def model_fn(model_dir):
    """
    Load the model from the model directory.
    Called when SageMaker deploys the model.
    """
    try:
        logger.info(f"Loading model from {model_dir}")
        
        # Look for the joblib file in the model directory
        model_path = os.path.join(model_dir, "voiceguard_scam_model.joblib")
        
        if not os.path.exists(model_path):
            # Try to find any joblib file in the directory
            for file in os.listdir(model_dir):
                if file.endswith(".joblib"):
                    model_path = os.path.join(model_dir, file)
                    break
        
        logger.info(f"Found model at {model_path}")
        model = joblib.load(model_path)
        logger.info("Model loaded successfully")
        
        return model
    except Exception as e:
        logger.error(f"Error loading model: {str(e)}")
        raise

def input_fn(request_body, request_content_type):
    """
    Parse input data from the request.
    Supports both JSON and plain text input.
    """
    logger.info(f"Parsing input with content type: {request_content_type}")
    
    if request_content_type == "application/json":
        try:
            input_data = json.loads(request_body)
            # Handle different input formats
            if isinstance(input_data, dict):
                # If input is a dictionary with 'text' key
                text = input_data.get("text", "")
                if isinstance(text, list):
                    # Multiple text inputs
                    return text
                else:
                    # Single text input
                    return [text]
            elif isinstance(input_data, list):
                # Direct list of text inputs
                return input_data
            else:
                # Single string
                return [str(input_data)]
        except Exception as e:
            logger.error(f"Error parsing JSON: {str(e)}")
            raise
    
    elif request_content_type == "text/plain":
        # Plain text input
        return [str(request_body)]
    
    else:
        # Default: treat as plain text
        logger.warning(f"Unsupported content type: {request_content_type}, treating as plain text")
        return [str(request_body)]

def predict_fn(input_data, model):
    """
    Make predictions using the loaded model.
    """
    logger.info(f"Making predictions for {len(input_data)} input(s)")
    
    try:
        # Model expects text input for transformation
        predictions = model.predict(input_data)
        
        # Get prediction probabilities if available
        if hasattr(model, "predict_proba"):
            probabilities = model.predict_proba(input_data)
            # Assuming binary classification: [not_scam_probability, scam_probability]
            scam_probabilities = probabilities[:, 1] if probabilities.shape[1] > 1 else probabilities[:, 0]
        else:
            # If no probability method, create dummy probabilities
            scam_probabilities = np.array(predictions).astype(float)
        
        # Format results
        results = []
        for i, (pred, prob) in enumerate(zip(predictions, scam_probabilities)):
            result = {
                "text": input_data[i] if i < len(input_data) else "",
                "is_scam": bool(pred),
                "scam_probability": float(prob),
                "confidence": "high" if prob > 0.7 else "medium" if prob > 0.4 else "low"
            }
            results.append(result)
        
        logger.info(f"Predictions complete: {len(results)} results")
        return results
    
    except Exception as e:
        logger.error(f"Error during prediction: {str(e)}")
        raise

def output_fn(prediction_output, content_type):
    """
    Format the prediction output for the response.
    """
    logger.info(f"Formatting output with content type: {content_type}")
    
    if content_type == "application/json":
        # Return as JSON
        response = {
            "predictions": prediction_output,
            "model_version": "1.0.0",
            "timestamp": np.datetime64('now').astype(str)
        }
        return json.dumps(response)
    
    elif content_type == "text/plain":
        # Return simplified text output
        outputs = []
        for pred in prediction_output:
            status = "🚫 SCAM" if pred["is_scam"] else "✅ Legitimate"
            outputs.append(f"{status} (Confidence: {pred['confidence']}, Probability: {pred['scam_probability']:.2f})")
        return "\n".join(outputs)
    
    else:
        # Default to JSON
        return json.dumps(prediction_output)

if __name__ == "__main__":
    """
    Local testing mode - useful for debugging.
    """
    import argparse
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=str, default="./")
    parser.add_argument("--text", type=str, default="This is a test call about your car warranty")
    parser.add_argument("--content-type", type=str, default="application/json")
    args = parser.parse_args()
    
    # Load model
    model = model_fn(args.model_dir)
    
    # Process input
    input_data = input_fn(args.text, args.content_type)
    
    # Make prediction
    predictions = predict_fn(input_data, model)
    
    # Format output
    output = output_fn(predictions, args.content_type)
    
    print("Prediction Results:")
    print(output)