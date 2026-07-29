import React, { useState, useEffect } from 'react';
import { Eye, Ruler, CheckCircle, AlertCircle, ArrowDown, ArrowUp, ArrowLeft, ArrowRight } from 'lucide-react';

/**
 * Lens Calibration Guide Component
 * Provides specialized calibration for lens measurements using head movement data
 */
export function LensCalibrationGuide({
  headAlignment,
  landmarks,
  onCalibrationComplete,
  currentStep = 0,
  setCurrentStep
}) {
  const [calibrationPoints, setCalibrationPoints] = useState([]);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [guidance, setGuidance] = useState('');
  const [quality, setQuality] = useState(0);
  
  // Lens calibration steps
  const calibrationSteps = [
    {
      id: 'center',
      label: 'Center Position',
      description: 'Look straight at the camera with your head level',
      targetPose: { yaw: 0, pitch: 0, roll: 0 },
      eyePositionCheck: true
    },
    {
      id: 'reading',
      label: 'Reading Position',
      description: 'Look slightly down as if reading a book',
      targetPose: { yaw: 0, pitch: 0.15, roll: 0 },
      eyePositionCheck: true
    },
    {
      id: 'distance',
      label: 'Distance Vision',
      description: 'Look straight ahead as if viewing a distant object',
      targetPose: { yaw: 0, pitch: -0.05, roll: 0 },
      eyePositionCheck: true
    },
    {
      id: 'complete',
      label: 'Calibration Complete',
      description: 'Lens calibration completed successfully',
      isCompleteStep: true
    }
  ];
  
  // Current step
  const step = calibrationSteps[currentStep];
  
  // Reset calibration data when component mounts
  useEffect(() => {
    setCalibrationPoints([]);
    setIsCalibrating(false);
    setProgress(0);
    setGuidance('');
    setQuality(0);
  }, []);
  
  // Monitor head alignment for current step
  useEffect(() => {
    if (!headAlignment || !step || step.isCompleteStep || !isCalibrating) return;
    
    const checkAlignment = () => {
      // Check if head is properly aligned for current calibration step
      const { yaw, pitch, roll } = headAlignment;
      const targetPose = step.targetPose;
      
      // Calculate alignment based on target pose
      const yawDiff = Math.abs(yaw - (targetPose.yaw || 0));
      const pitchDiff = Math.abs(pitch - (targetPose.pitch || 0));
      const rollDiff = Math.abs(roll - (targetPose.roll || 0));
      
      // Set thresholds for alignment
      const threshold = 0.08;
      const isAligned = yawDiff < threshold && pitchDiff < threshold && rollDiff < threshold;
      
      // Generate guidance message
      let message;
      if (!isAligned) {
        if (yawDiff >= threshold) {
          message = yaw > (targetPose.yaw || 0) ? 'Turn slightly right' : 'Turn slightly left';
        } else if (pitchDiff >= threshold) {
          message = pitch > (targetPose.pitch || 0) ? 'Tilt your head down more' : 'Tilt your head up more';
        } else if (rollDiff >= threshold) {
          message = roll > (targetPose.roll || 0) ? 'Level your head (tilt right)' : 'Level your head (tilt left)';
        }
      } else {
        message = 'Perfect! Hold this position';
      }
      
      setGuidance(message);
      
      // Calculate progress
      const alignmentProgress = Math.max(0, 1 - ((yawDiff + pitchDiff + rollDiff) / 0.75));
      setProgress(isAligned ? 1 : alignmentProgress);
      
      return isAligned;
    };
    
    // If aligned and eye position is good, record the calibration point
    if (checkAlignment() && step.eyePositionCheck && landmarks) {
      // Check if eyes are visible and clear
      const leftEye = landmarks[33]; // Left eye outer corner
      const rightEye = landmarks[263]; // Right eye outer corner
      const leftIris = landmarks[468]; // Left iris center
      const rightIris = landmarks[473]; // Right iris center
      
      if (leftEye && rightEye && leftIris && rightIris) {
        // Check eye opening and visibility
        const leftEyeOpening = Math.abs(landmarks[159].y - landmarks[145].y);
        const rightEyeOpening = Math.abs(landmarks[386].y - landmarks[374].y);
        const minEyeOpening = 0.01; // Minimum eye opening threshold
        
        if (leftEyeOpening > minEyeOpening && rightEyeOpening > minEyeOpening) {
          // Calculate lens calibration metrics
          const calibrationPoint = {
            step: step.id,
            timestamp: Date.now(),
            eyePositions: {
              leftIris: { x: leftIris.x, y: leftIris.y, z: leftIris.z },
              rightIris: { x: rightIris.x, y: rightIris.y, z: rightIris.z },
              pdLeft: landmarks[468].x - landmarks[473].x,
              pdRight: landmarks[473].x - landmarks[468].x
            },
            headPose: { ...headAlignment }
          };
          
          // Check if we already have a calibration point for this step
          const existingPointIndex = calibrationPoints.findIndex(p => p.step === step.id);
          
          if (existingPointIndex >= 0) {
            // Update existing point
            const updatedPoints = [...calibrationPoints];
            updatedPoints[existingPointIndex] = calibrationPoint;
            setCalibrationPoints(updatedPoints);
          } else {
            // Add new point
            setCalibrationPoints(prevPoints => [...prevPoints, calibrationPoint]);
            
            // Move to next step after brief pause
            setTimeout(() => {
              if (currentStep < calibrationSteps.length - 1) {
                setCurrentStep(currentStep + 1);
              }
            }, 1500);
          }
          
          // Calculate quality score
          const qualityScore = (1 - ((yawDiff + pitchDiff + rollDiff) / 0.3)) * 
                              (leftEyeOpening + rightEyeOpening) * 10;
          setQuality(Math.min(1, Math.max(0, qualityScore)));
        } else {
          setGuidance('Please open your eyes wider');
        }
      } else {
        setGuidance('Cannot detect eyes clearly. Adjust position.');
      }
    }
  }, [headAlignment, landmarks, step, currentStep, isCalibrating, calibrationPoints]);
  
  // When all calibration points are collected, process lens calibration
  useEffect(() => {
    if (
      calibrationPoints.length === calibrationSteps.length - 1 && 
      currentStep === calibrationSteps.length - 1
    ) {
      // All calibration points collected, calculate final lens calibration
      const lensCalibrationData = processLensCalibration(calibrationPoints);
      
      // Notify parent component
      if (onCalibrationComplete) {
        onCalibrationComplete(lensCalibrationData);
      }
    }
  }, [calibrationPoints, currentStep, calibrationSteps.length, onCalibrationComplete]);
  
  // Process collected calibration points into lens-specific measurements
  const processLensCalibration = (points) => {
    // Extract center point as reference
    const centerPoint = points.find(p => p.step === 'center');
    const readingPoint = points.find(p => p.step === 'reading');
    const distancePoint = points.find(p => p.step === 'distance');
    
    if (!centerPoint || !readingPoint || !distancePoint) {
      return null;
    }
    
    // Calculate lens-specific measurements
    
    // 1. Reading Add - vertical eye movement from center to reading position
    const readingAdd = Math.abs(
      readingPoint.eyePositions.leftIris.y - centerPoint.eyePositions.leftIris.y +
      readingPoint.eyePositions.rightIris.y - centerPoint.eyePositions.rightIris.y
    ) / 2;
    
    // 2. Distance-near ratio - ratio of eye positions between distance and reading
    const distanceNearRatio = (
      Math.abs(distancePoint.eyePositions.leftIris.y - distancePoint.eyePositions.rightIris.y) /
      Math.abs(readingPoint.eyePositions.leftIris.y - readingPoint.eyePositions.rightIris.y)
    );
    
    // 3. Progressive corridor height - vertical distance needed for smooth transition
    const corridorHeight = Math.abs(
      distancePoint.eyePositions.leftIris.y - readingPoint.eyePositions.leftIris.y +
      distancePoint.eyePositions.rightIris.y - readingPoint.eyePositions.rightIris.y
    ) / 2;
    
    // 4. Calculate optimal optical center height
    const opticalCenterHeight = (
      centerPoint.eyePositions.leftIris.y + centerPoint.eyePositions.rightIris.y
    ) / 2;
    
    // 5. Calculate minimum fitting height for progressives
    const minFittingHeight = corridorHeight * 1.2; // Add 20% margin
    
    return {
      readingAdd,
      distanceNearRatio,
      corridorHeight,
      opticalCenterHeight,
      minFittingHeight,
      qualityScore: quality,
      calibrationPoints: points
    };
  };
  
  return (
    <div className="lens-calibration-guide">
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Eye className="text-indigo-600" size={18} />
          <h3 className="font-semibold text-gray-900">{step?.label}</h3>
        </div>
        <p className="text-gray-600 text-sm">{step?.description}</p>
      </div>
      
      {/* Progress indicator */}
      {!step?.isCompleteStep && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Alignment Progress</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className={`h-2 rounded-full ${progress === 1 ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}
      
      {/* Guidance */}
      {!step?.isCompleteStep && guidance && (
        <div className={`flex items-center gap-2 p-2 rounded-lg mb-4 ${
          guidance.includes('Perfect') ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-800'
        }`}>
          {guidance.includes('Perfect') ? (
            <CheckCircle size={18} className="text-green-500" />
          ) : getGuidanceIcon(guidance)}
          <span className="text-sm">{guidance}</span>
        </div>
      )}
      
      {/* Calibration points collected */}
      {currentStep > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Calibration Points</span>
            <span>{calibrationPoints.length}/{calibrationSteps.length - 1}</span>
          </div>
          <div className="flex gap-1 mt-2">
            {calibrationSteps.slice(0, -1).map((s, i) => (
              <div 
                key={s.id}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                  calibrationPoints.some(p => p.step === s.id) 
                    ? 'bg-green-500 text-white' 
                    : i === currentStep
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-500'
                }`}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Final results */}
      {step?.isCompleteStep && calibrationPoints.length === calibrationSteps.length - 1 && (
        <div className="lens-calibration-results">
          <div className="flex items-center gap-2 mb-4 p-2 bg-green-50 text-green-800 rounded-lg">
            <CheckCircle size={18} className="text-green-600" />
            <span>Lens calibration completed successfully</span>
          </div>
          
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Calibration Quality</span>
              <span>{Math.round(quality * 100)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${
                  quality > 0.7 ? 'bg-green-500' : quality > 0.4 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${quality * 100}%` }}
              />
            </div>
          </div>
          
          {/* Show lens calibration measurements */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-50 p-2 rounded">
              <span className="text-xs text-gray-500">Reading Add</span>
              <div className="font-semibold">Optimized</div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <span className="text-xs text-gray-500">Progressive Height</span>
              <div className="font-semibold">Calculated</div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <span className="text-xs text-gray-500">Optical Center</span>
              <div className="font-semibold">Optimized</div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <span className="text-xs text-gray-500">Min Fitting Height</span>
              <div className="font-semibold">Calculated</div>
            </div>
          </div>
        </div>
      )}
      
      {/* Start calibration button */}
      {!step?.isCompleteStep && (
        <button
          onClick={() => setIsCalibrating(true)}
          disabled={isCalibrating}
          className={`px-4 py-2 rounded-lg text-white ${
            isCalibrating ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700'
          } transition-colors`}
        >
          {isCalibrating ? 'Calibrating...' : 'Start Lens Calibration'}
        </button>
      )}
    </div>
  );
}

// Helper function to get appropriate icon for guidance message
function getGuidanceIcon(guidance) {
  if (guidance.includes('left')) {
    return <ArrowLeft size={18} className="text-yellow-600" />;
  } else if (guidance.includes('right')) {
    return <ArrowRight size={18} className="text-yellow-600" />;
  } else if (guidance.includes('up')) {
    return <ArrowUp size={18} className="text-yellow-600" />;
  } else if (guidance.includes('down')) {
    return <ArrowDown size={18} className="text-yellow-600" />;
  }
  return <AlertCircle size={18} className="text-yellow-600" />;
}

export default LensCalibrationGuide;
