import React, { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, RotateCcw, RotateCw, Check, AlertCircle } from 'lucide-react';

/**
 * Head Movement Guide Component
 * Provides visual guidance for head movement calibration
 */
export function HeadMovementGuide({
  currentMovement,
  headPose,
  targetPose,
  onMovementComplete,
  isRecording,
}) {
  const [progress, setProgress] = useState(0);
  const [holdTimer, setHoldTimer] = useState(0);
  const holdTimeRequired = 1.5; // seconds to hold position
  const [guidance, setGuidance] = useState({ isAligned: false, message: '' });
  const [completedMovements, setCompletedMovements] = useState([]);

  // Movement definitions with target poses and icons
  const movements = [
    { 
      id: 'neutral', 
      label: 'Look straight ahead',
      description: 'Center your head and look directly at the camera',
      targetPose: { yaw: 0, pitch: 0, roll: 0 },
      icon: Check,
      color: 'bg-green-500',
    },
    { 
      id: 'turn_left', 
      label: 'Turn left',
      description: 'Slowly turn your head to the left',
      targetPose: { yaw: 0.3, pitch: 0, roll: 0 },
      icon: ArrowLeft,
      color: 'bg-blue-500',
    },
    { 
      id: 'turn_right', 
      label: 'Turn right',
      description: 'Slowly turn your head to the right',
      targetPose: { yaw: -0.3, pitch: 0, roll: 0 },
      icon: ArrowRight,
      color: 'bg-blue-500',
    },
    { 
      id: 'tilt_up', 
      label: 'Look up',
      description: 'Tilt your head slightly upward',
      targetPose: { yaw: 0, pitch: -0.2, roll: 0 },
      icon: ArrowUp,
      color: 'bg-purple-500',
    },
    { 
      id: 'tilt_down', 
      label: 'Look down',
      description: 'Tilt your head slightly downward',
      targetPose: { yaw: 0, pitch: 0.2, roll: 0 },
      icon: ArrowDown,
      color: 'bg-purple-500',
    },
    { 
      id: 'roll_left', 
      label: 'Tilt left',
      description: 'Tilt your head to the left (ear toward shoulder)',
      targetPose: { yaw: 0, pitch: 0, roll: 0.15 },
      icon: RotateCcw,
      color: 'bg-orange-500',
    },
    { 
      id: 'roll_right', 
      label: 'Tilt right',
      description: 'Tilt your head to the right (ear toward shoulder)',
      targetPose: { yaw: 0, pitch: 0, roll: -0.15 },
      icon: RotateCw,
      color: 'bg-orange-500',
    },
    { 
      id: 'neutral_final', 
      label: 'Center again',
      description: 'Return to the center position facing the camera',
      targetPose: { yaw: 0, pitch: 0, roll: 0 },
      icon: Check,
      color: 'bg-green-500',
    },
  ];

  // Find the current movement definition
  const currentMovementDef = movements.find(m => m.id === currentMovement) || movements[0];

  // Check if head is aligned with target pose
  useEffect(() => {
    if (!headPose || !targetPose) return;
    
    const yawThreshold = 0.1;
    const pitchThreshold = 0.1;
    const rollThreshold = 0.1;
    
    const yawDiff = Math.abs(headPose.yaw - targetPose.yaw);
    const pitchDiff = Math.abs(headPose.pitch - targetPose.pitch);
    const rollDiff = Math.abs(headPose.roll - targetPose.roll);
    
    const isAligned = yawDiff < yawThreshold && 
                       pitchDiff < pitchThreshold &&
                       rollDiff < rollThreshold;
    
    let message = 'Perfect! Hold this position';
    if (!isAligned) {
      if (yawDiff >= yawThreshold) {
        message = headPose.yaw > targetPose.yaw ? 'Turn head more to the right' : 'Turn head more to the left';
      } else if (pitchDiff >= pitchThreshold) {
        message = headPose.pitch > targetPose.pitch ? 'Tilt head up more' : 'Tilt head down more';
      } else if (rollDiff >= rollThreshold) {
        message = headPose.roll > targetPose.roll ? 'Straighten your head (tilt right)' : 'Straighten your head (tilt left)';
      }
    }
    
    setGuidance({ isAligned, message });
    
    // Calculate overall progress
    const totalDiff = yawDiff + pitchDiff + rollDiff;
    const maxDiff = 1.0; // Maximum reasonable difference
    setProgress(Math.max(0, Math.min(1, 1 - (totalDiff / maxDiff))));
  }, [headPose, targetPose]);
  
  // Handle hold timer for position
  useEffect(() => {
    let interval;
    
    if (guidance.isAligned && isRecording) {
      interval = setInterval(() => {
        setHoldTimer(prev => {
          const newValue = prev + 0.1;
          if (newValue >= holdTimeRequired) {
            if (onMovementComplete && currentMovement) {
              setCompletedMovements(prev => [...prev, currentMovement]);
              onMovementComplete(currentMovement);
            }
            clearInterval(interval);
            return holdTimeRequired;
          }
          return newValue;
        });
      }, 100);
    } else {
      setHoldTimer(0);
    }
    
    return () => clearInterval(interval);
  }, [guidance.isAligned, isRecording, onMovementComplete, currentMovement]);

  // Reset timer when movement changes
  useEffect(() => {
    setHoldTimer(0);
  }, [currentMovement]);

  const Icon = currentMovementDef?.icon || Check;
  
  return (
    <div className="movement-guide">
      {/* Current movement indicator */}
      <div className="flex items-center mb-4">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${currentMovementDef.color} text-white mr-4`}>
          <Icon size={24} />
        </div>
        <div>
          <h3 className="text-lg font-semibold">{currentMovementDef.label}</h3>
          <p className="text-gray-600">{currentMovementDef.description}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 mb-3">
        <div 
          className={`h-2.5 rounded-full ${guidance.isAligned ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Hold timer when aligned */}
      {guidance.isAligned && (
        <div className="w-full bg-gray-200 rounded-full h-2.5 mb-3">
          <div 
            className="h-2.5 rounded-full bg-green-500 transition-all duration-100"
            style={{ width: `${(holdTimer / holdTimeRequired) * 100}%` }}
          />
        </div>
      )}

      {/* Guidance message */}
      <div className="flex items-center p-3 rounded-lg mb-4 bg-gray-50 border border-gray-200">
        <span className={`w-3 h-3 rounded-full mr-2 ${guidance.isAligned ? 'bg-green-500' : 'bg-orange-500'}`}></span>
        <p className="text-gray-700">{guidance.message}</p>
      </div>

      {/* Movement sequence progress */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {movements.map((movement, idx) => (
          <div 
            key={movement.id} 
            className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
              completedMovements.includes(movement.id) 
                ? 'border-green-500 bg-green-100' 
                : currentMovement === movement.id 
                  ? 'border-blue-500 bg-blue-100' 
                  : 'border-gray-300 bg-gray-50'
            }`}
            title={movement.label}
          >
            <span className="text-xs font-medium">{idx + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default HeadMovementGuide;
