#!/usr/bin/env python3
"""
ML Client for VoxShield scam detection.
Provides a unified interface for calling the SageMaker endpoint.
"""

import boto3
import json
import logging
import os
import time
from typing import Dict, List, Any, Optional, Union
from datetime import datetime
from dataclasses import dataclass
import hashlib

# Set up logging
logger = logging.getLogger(__name__)

@dataclass
class ScamPrediction:
    """Represents a scam prediction result."""
    text: str
    is_scam: bool
    scam_probability: float
    confidence: str  # 'low', 'medium', 'high'
    model_version: str
    timestamp: str
    prediction_id: Optional[str] = None
    
    def __post_init__(self):
        if self.prediction_id is None:
            # Generate ID from text and timestamp
            content = f"{self.text}{self.timestamp}{self.scam_probability}"
            self.prediction_id = hashlib.md5(content.encode()).hexdigest()[:12]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'prediction_id': self.prediction_id,
            'text': self.text,
            'is_scam': self.is_scam,
            'scam_probability': self.scam_probability,
            'confidence': self.confidence,
            'model_version': self.model_version,
            'timestamp': self.timestamp
        }
    
    def is_confident_prediction(self) -> bool:
        """Check if prediction is confident (high probability)."""
        return self.confidence == 'high'
    
    def get_alert_level(self) -> str:
        """Get alert level for UI display."""
        if self.scam_probability >= 0.8:
            return 'danger'
        elif self.scam_probability >= 0.5:
            return 'warning'
        else:
            return 'info'

class MLClient:
    """Client for interacting with SageMaker ML endpoint."""
    
    def __init__(self, endpoint_name: str = None, region: str = 'us-east-1'):
        """
        Initialize ML client.
        
        Args:
            endpoint_name: SageMaker endpoint name
            region: AWS region
        """
        self.endpoint_name = endpoint_name or os.environ.get(
            'SAGEMAKER_ENDPOINT_NAME', 'voxshield-scam-detector'
        )
        self.region = region
        
        # Initialize SageMaker runtime client
        self.client = boto3.client('sagemaker-runtime', region_name=self.region)
        
        # Cache for recent predictions
        self.prediction_cache: Dict[str, ScamPrediction] = {}
        self.max_cache_size = 100
        
        logger.info(f"ML Client initialized for endpoint: {self.endpoint_name}")
    
    def predict(self, text: Union[str, List[str]], **kwargs) -> Union[ScamPrediction, List[ScamPrediction]]:
        """
        Make prediction(s) on text.
        
        Args:
            text: Single text string or list of texts
            **kwargs: Additional parameters for the endpoint
            
        Returns:
            ScamPrediction or list of ScamPredictions
        """
        try:
            # Handle single text vs list
            is_single = isinstance(text, str)
            texts = [text] if is_single else text
            
            if not texts:
                logger.warning("No text provided for prediction")
                return [] if not is_single else None
            
            # Check cache for each text
            cached_results = []
            texts_to_predict = []
            
            for txt in texts:
                cache_key = self._get_cache_key(txt)
                if cache_key in self.prediction_cache:
                    cached_results.append(self.prediction_cache[cache_key])
                else:
                    texts_to_predict.append(txt)
            
            # Predict remaining texts
            new_predictions = []
            if texts_to_predict:
                new_predictions = self._call_endpoint(texts_to_predict, **kwargs)
                
                # Add to cache
                for prediction in new_predictions:
                    cache_key = self._get_cache_key(prediction.text)
                    self.prediction_cache[cache_key] = prediction
                    
                    # Limit cache size
                    if len(self.prediction_cache) > self.max_cache_size:
                        # Remove oldest entry
                        oldest_key = next(iter(self.prediction_cache))
                        del self.prediction_cache[oldest_key]
            
            # Combine cached and new predictions
            all_predictions = cached_results + new_predictions
            
            # Ensure order matches input
            if len(all_predictions) == len(texts):
                # Map back to original order
                prediction_map = {p.text: p for p in all_predictions}
                ordered_predictions = [prediction_map[txt] for txt in texts]
            else:
                # Something went wrong, return as-is
                ordered_predictions = all_predictions
            
            return ordered_predictions[0] if is_single else ordered_predictions
            
        except Exception as e:
            logger.error(f"Error making prediction: {e}")
            raise
    
    def _call_endpoint(self, texts: List[str], **kwargs) -> List[ScamPrediction]:
        """Call SageMaker endpoint with texts."""
        try:
            # Prepare request
            request_data = {
                'text': texts if len(texts) > 1 else texts[0]
            }
            
            # Add any additional parameters
            if kwargs:
                request_data.update(kwargs)
            
            logger.info(f"Calling SageMaker endpoint with {len(texts)} text(s)")
            
            # Invoke endpoint
            response = self.client.invoke_endpoint(
                EndpointName=self.endpoint_name,
                ContentType='application/json',
                Body=json.dumps(request_data)
            )
            
            # Parse response
            response_body = response['Body'].read().decode('utf-8')
            result = json.loads(response_body)
            
            # Extract predictions
            predictions_data = result.get('predictions', [])
            model_version = result.get('model_version', '1.0.0')
            
            predictions = []
            for i, pred_data in enumerate(predictions_data):
                # Ensure we have text for this prediction
                text = pred_data.get('text', texts[i] if i < len(texts) else '')
                
                prediction = ScamPrediction(
                    text=text,
                    is_scam=pred_data.get('is_scam', False),
                    scam_probability=pred_data.get('scam_probability', 0.0),
                    confidence=pred_data.get('confidence', 'low'),
                    model_version=model_version,
                    timestamp=datetime.now().isoformat()
                )
                predictions.append(prediction)
            
            logger.info(f"Received {len(predictions)} predictions from endpoint")
            return predictions
            
        except self.client.exceptions.ModelError as e:
            logger.error(f"Model error: {e}")
            raise
        except self.client.exceptions.InternalFailure as e:
            logger.error(f"SageMaker internal failure: {e}")
            raise
        except Exception as e:
            logger.error(f"Error calling endpoint: {e}")
            raise
    
    def _get_cache_key(self, text: str) -> str:
        """Generate cache key for text."""
        # Simple hash of text (first 100 chars for efficiency)
        text_for_hash = text[:100] if len(text) > 100 else text
        return hashlib.md5(text_for_hash.encode()).hexdigest()
    
    def batch_predict(self, texts: List[str], batch_size: int = 10, **kwargs) -> List[ScamPrediction]:
        """
        Make predictions in batches.
        
        Args:
            texts: List of texts to predict
            batch_size: Number of texts per batch
            **kwargs: Additional parameters
            
        Returns:
            List of ScamPredictions
        """
        all_predictions = []
        
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            logger.info(f"Processing batch {i//batch_size + 1} ({len(batch)} texts)")
            
            try:
                batch_predictions = self.predict(batch, **kwargs)
                all_predictions.extend(batch_predictions)
                
                # Small delay between batches to avoid throttling
                if i + batch_size < len(texts):
                    time.sleep(0.1)
                    
            except Exception as e:
                logger.error(f"Error in batch {i//batch_size + 1}: {e}")
                # Add placeholder predictions for failed batch
                for text in batch:
                    all_predictions.append(
                        ScamPrediction(
                            text=text,
                            is_scam=False,
                            scam_probability=0.0,
                            confidence='low',
                            model_version='error',
                            timestamp=datetime.now().isoformat()
                        )
                    )
        
        return all_predictions
    
    def get_endpoint_status(self) -> Dict[str, Any]:
        """Get endpoint status."""
        try:
            sagemaker = boto3.client('sagemaker', region_name=self.region)
            response = sagemaker.describe_endpoint(EndpointName=self.endpoint_name)
            
            return {
                'status': response['EndpointStatus'],
                'creation_time': response.get('CreationTime'),
                'last_modified_time': response.get('LastModifiedTime'),
                'endpoint_arn': response['EndpointArn']
            }
        except Exception as e:
            logger.error(f"Error getting endpoint status: {e}")
            return {'error': str(e), 'status': 'unknown'}
    
    def clear_cache(self) -> None:
        """Clear prediction cache."""
        self.prediction_cache.clear()
        logger.info("Prediction cache cleared")

class MockMLClient(MLClient):
    """Mock ML client for testing without actual endpoint."""
    
    def __init__(self, endpoint_name: str = 'mock-endpoint', region: str = 'us-east-1'):
        super().__init__(endpoint_name, region)
        logger.info("Using MockMLClient (no actual SageMaker calls)")
    
    def _call_endpoint(self, texts: List[str], **kwargs) -> List[ScamPrediction]:
        """Mock endpoint call for testing."""
        # Common scam keywords
        scam_keywords = [
            'warranty', 'expire', 'social security', 'irs', 'tax', 'microsoft',
            'virus', 'computer', 'compromised', 'owe', 'back taxes',
            'free vacation', 'won', 'prize', 'lottery', 'bank account',
            'suspended', 'arrest', 'warrant', 'urgent', 'immediately'
        ]
        
        predictions = []
        for text in texts:
            text_lower = text.lower()
            
            # Check for scam keywords
            scam_score = 0
            for keyword in scam_keywords:
                if keyword in text_lower:
                    scam_score += 0.2
            
            # Normalize probability
            scam_probability = min(1.0, scam_score)
            is_scam = scam_probability > 0.5
            
            # Determine confidence
            if scam_probability > 0.7:
                confidence = 'high'
            elif scam_probability > 0.4:
                confidence = 'medium'
            else:
                confidence = 'low'
            
            prediction = ScamPrediction(
                text=text,
                is_scam=is_scam,
                scam_probability=scam_probability,
                confidence=confidence,
                model_version='mock-1.0.0',
                timestamp=datetime.now().isoformat()
            )
            predictions.append(prediction)
        
        return predictions

def test_ml_client():
    """Test the ML client."""
    print("Testing ML Client...")
    
    # Test with mock client
    client = MockMLClient()
    
    # Test phrases
    test_phrases = [
        "Your car warranty is about to expire",
        "This is Microsoft calling about a virus on your computer",
        "Hi mom, can you pick me up from school",
        "What are you doing for dinner tonight",
        "Your social security number has been compromised"
    ]
    
    print("Making predictions...")
    
    # Single prediction
    single_result = client.predict(test_phrases[0])
    print(f"\nSingle prediction:")
    print(f"  Text: {single_result.text[:50]}...")
    print(f"  Is scam: {single_result.is_scam}")
    print(f"  Probability: {single_result.scam_probability:.2%}")
    print(f"  Confidence: {single_result.confidence}")
    print(f"  Alert level: {single_result.get_alert_level()}")
    
    # Batch prediction
    batch_results = client.predict(test_phrases)
    print(f"\nBatch predictions ({len(batch_results)} results):")
    
    for i, result in enumerate(batch_results, 1):
        scam_flag = "🚫" if result.is_scam else "✅"
        print(f"  {i}. {scam_flag} {result.text[:40]}... (prob: {result.scam_probability:.2%})")
    
    # Test cache
    print(f"\nCache size: {len(client.prediction_cache)}")
    
    # Make same predictions again (should use cache)
    cached_results = client.predict(test_phrases[:2])
    print(f"Made predictions again, cache size: {len(client.prediction_cache)}")
    
    # Clear cache
    client.clear_cache()
    print(f"Cleared cache, size: {len(client.prediction_cache)}")
    
    print("\n✅ ML Client tests completed")

if __name__ == '__main__':
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    # Run tests
    test_ml_client()