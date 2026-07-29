/**
 * Head Movement Service
 * Handles head movement tracking, recording sequences and 3D facial reconstruction
 */

export class HeadMovementService {
  /**
   * Calculate head pose from face landmarks
   */
  static calculateHeadPose(landmarks) {
    if (!landmarks || landmarks.length < 468) {
      return { yaw: 0, pitch: 0, roll: 0 };
    }
    
    // Key landmark indices
    const nose = landmarks[1]; // Nose tip
    const leftEye = landmarks[33]; // Left eye outer corner
    const rightEye = landmarks[263]; // Right eye outer corner
    const chin = landmarks[152]; // Chin bottom
    const forehead = landmarks[10]; // Forehead
    
    // Calculate yaw (left/right rotation)
    const eyeDistance = Math.abs((leftEye.x - nose.x) - (nose.x - rightEye.x)) / (leftEye.x - rightEye.x);
    const yaw = Math.min(1, eyeDistance * 2); // 0 = perfectly centered, 1 = extreme rotation
    
    // Calculate pitch (up/down tilt)
    const eyesY = (leftEye.y + rightEye.y) / 2;
    const eyeNoseRatio = (nose.y - eyesY) / (chin.y - forehead.y);
    // Normalize around expected value (approx 0.28 for neutral pose)
    const pitch = Math.min(1, Math.abs((eyeNoseRatio - 0.28) * 5));
    
    // Calculate roll (head tilt)
    const roll = Math.min(1, Math.abs((leftEye.y - rightEye.y) / (leftEye.x - rightEye.x)) * 2);
    
    return { yaw, pitch, roll };
  }

  /**
   * Record frame in movement sequence
   */
  static recordFrame(landmarks, movementSequence, currentMovementType) {
    if (!landmarks) return movementSequence;
    
    const timestamp = Date.now();
    const headPose = this.calculateHeadPose(landmarks);
    
    // Create frame data
    const frame = {
      timestamp,
      landmarks: landmarks.slice(0, 478), // Store main landmarks including iris
      headPose,
      movementType: currentMovementType,
      irises: {
        left: landmarks[468], // Left iris center
        right: landmarks[473] // Right iris center
      }
    };
    
    // Add to sequence
    return {
      ...movementSequence,
      frames: [...movementSequence.frames, frame]
    };
  }
  
  /**
   * Get current movement guidance
   */
  static getMovementGuidance(headPose, targetPose) {
    // Calculate how close we are to target pose
    const yawDiff = Math.abs(headPose.yaw - targetPose.yaw);
    const pitchDiff = Math.abs(headPose.pitch - targetPose.pitch);
    const rollDiff = Math.abs(headPose.roll - targetPose.roll);
    
    const isAligned = yawDiff < 0.1 && pitchDiff < 0.1 && rollDiff < 0.1;
    
    return {
      isAligned,
      progress: isAligned ? 1 : 0.5 - (yawDiff + pitchDiff + rollDiff) / 3,
      message: this.getGuidanceMessage(headPose, targetPose)
    };
  }
  
  /**
   * Generate guidance message
   */
  static getGuidanceMessage(headPose, targetPose) {
    if (Math.abs(headPose.yaw - targetPose.yaw) > 0.1) {
      return headPose.yaw > targetPose.yaw ? 'Turn head more to the right' : 'Turn head more to the left';
    } else if (Math.abs(headPose.pitch - targetPose.pitch) > 0.1) {
      return headPose.pitch > targetPose.pitch ? 'Tilt head down more' : 'Tilt head up more';
    } else if (Math.abs(headPose.roll - targetPose.roll) > 0.1) {
      return headPose.roll > targetPose.roll ? 'Straighten your head (roll right)' : 'Straighten your head (roll left)';
    }
    
    return 'Perfect! Hold this position';
  }
  
  /**
   * Extract depth information from movement sequence
   */
  static calculateDepthMap(movementSequence) {
    if (!movementSequence.frames || movementSequence.frames.length < 10) {
      return null; // Not enough frames for depth estimation
    }
    
    // Find optimal reference frame (most neutral pose)
    const referenceFrame = this.findOptimalReferenceFrame(movementSequence.frames);
    if (!referenceFrame) return null;
    
    // Simple depth estimation based on motion parallax
    // This is a simplified implementation - a real one would use more sophisticated SfM techniques
    const depthMap = {};
    
    // For key facial landmarks, track movement relative to rotation
    [1, 33, 263, 61, 291, 199, 429, 468, 473].forEach(idx => {
      const refPoint = referenceFrame.landmarks[idx];
      const motionVectors = [];
      
      // Calculate motion vectors across frames
      movementSequence.frames.forEach(frame => {
        if (frame === referenceFrame) return;
        
        const point = frame.landmarks[idx];
        const rotationDiff = Math.abs(frame.headPose.yaw - referenceFrame.headPose.yaw);
        
        // Skip frames with very small rotation difference
        if (rotationDiff < 0.05) return;
        
        // Calculate motion vector
        const xMotion = (point.x - refPoint.x) / rotationDiff;
        motionVectors.push(xMotion);
      });
      
      // Estimate depth from motion
      if (motionVectors.length > 0) {
        // Average motion vectors (negative because closer points move more)
        const avgMotion = -1 * motionVectors.reduce((a, b) => a + b, 0) / motionVectors.length;
        // Normalize to 0-1 range where 1 is closest to camera
        depthMap[idx] = Math.max(0, Math.min(1, avgMotion));
      }
    });
    
    return {
      depthMap,
      referenceFrame
    };
  }
  
  /**
   * Find optimal reference frame (most neutral head pose)
   */
  static findOptimalReferenceFrame(frames) {
    if (!frames || frames.length === 0) return null;
    
    // Sort by how close the head pose is to neutral
    return frames.sort((a, b) => {
      const aDist = Math.abs(a.headPose.yaw) + Math.abs(a.headPose.pitch) + Math.abs(a.headPose.roll);
      const bDist = Math.abs(b.headPose.yaw) + Math.abs(b.headPose.pitch) + Math.abs(b.headPose.roll);
      return aDist - bDist;
    })[0];
  }
  
  /**
   * Calculate enhanced PD measurement using depth information
   */
  static calculateEnhancedPD(landmarks, depthMap, calibrationFactor) {
    if (!landmarks || !depthMap || !calibrationFactor) {
      return null;
    }
    
    const leftIris = landmarks[468];
    const rightIris = landmarks[473];
    
    // Basic PD calculation
    const pixelDistance = Math.sqrt(
      Math.pow(rightIris.x - leftIris.x, 2) +
      Math.pow(rightIris.y - leftIris.y, 2)
    );
    
    // Convert to mm using calibration factor
    const pdMm = pixelDistance / calibrationFactor;
    
    // Apply depth correction if we have depth data for both irises
    if (depthMap[468] !== undefined && depthMap[473] !== undefined) {
      // Average depth value
      const avgDepth = (depthMap[468] + depthMap[473]) / 2;
      // Correction factor (increases PD for points further from camera)
      const correctionFactor = 1 + (1 - avgDepth) * 0.05; // 0-5% correction
      
      return {
        pdTotal: (pdMm * correctionFactor).toFixed(1),
        pdRight: (pdMm * correctionFactor / 2).toFixed(1),
        pdLeft: (pdMm * correctionFactor / 2).toFixed(1),
        confidence: 0.95, // Higher confidence with depth data
        method: '3D Enhanced'
      };
    }
    
    // Fallback to standard PD
    return {
      pdTotal: pdMm.toFixed(1),
      pdRight: (pdMm / 2).toFixed(1),
      pdLeft: (pdMm / 2).toFixed(1),
      confidence: 0.85,
      method: 'Standard'
    };
  }
}

export default HeadMovementService;
