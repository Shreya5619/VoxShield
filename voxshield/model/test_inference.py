#!/usr/bin/env python3
"""
Test script to verify the inference script works locally.
"""

import sys
import os

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from inference import model_fn, input_fn, predict_fn, output_fn

def main():
    # Test with some sample scam-like phrases
    test_texts = [
        "This is a test call about your car warranty",
        "Your social security number has been compromised",
        "You owe taxes to the IRS",
        "I'm calling from Microsoft about your computer virus",
        "Hi mom, can you pick me up from school",
        "What are you doing for dinner tonight",
        "This is an important message about your bank account",
        "You've won a free vacation to the Bahamas"
    ]
    
    # Load model
    try:
        print("Loading model...")
        model = model_fn(".")  # Current directory
        print("✓ Model loaded successfully")
    except Exception as e:
        print(f"✗ Error loading model: {e}")
        return
    
    # Test each text
    for text in test_texts:
        print(f"\n{'='*60}")
        print(f"Testing: '{text}'")
        
        # Process input
        try:
            input_data = input_fn(text, "text/plain")
            print(f"✓ Input parsed: {len(input_data)} item(s)")
        except Exception as e:
            print(f"✗ Error parsing input: {e}")
            continue
        
        # Make prediction
        try:
            predictions = predict_fn(input_data, model)
            print(f"✓ Prediction made")
        except Exception as e:
            print(f"✗ Error during prediction: {e}")
            continue
        
        # Format output
        try:
            output = output_fn(predictions, "application/json")
            print(f"✓ Output formatted")
            
            # Print human-readable results
            for pred in predictions:
                scam_status = "🚫 SCAM" if pred["is_scam"] else "✅ Legitimate"
                print(f"\nResult: {scam_status}")
                print(f"Text: {pred['text'][:50]}...")
                print(f"Scam Probability: {pred['scam_probability']:.2%}")
                print(f"Confidence: {pred['confidence']}")
        except Exception as e:
            print(f"✗ Error formatting output: {e}")
            continue
    
    print(f"\n{'='*60}")
    print("All tests completed!")

if __name__ == "__main__":
    main()