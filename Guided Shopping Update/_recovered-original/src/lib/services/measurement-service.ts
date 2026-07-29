/**
 * Measurement Service
 * Handles PD calculation, calibration, seg/OC height, and face geometry extraction
 * Uses MediaPipe Face Mesh landmarks for all measurements
 */

// MediaPipe Face Mesh landmark indices
// Full map: https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
export const LANDMARKS = {
  // Pupil centers (iris landmarks from Face Mesh v2)
  LEFT_IRIS_CENTER: 468,
  RIGHT_IRIS_CENTER: 473,

  // Left iris ring
  LEFT_IRIS: [468, 469, 470, 471, 472],
  // Right iris ring
  RIGHT_IRIS: [473, 474, 475, 476, 477],

  // Eye corners (for fallback PD if iris not available)
  LEFT_EYE_INNER: 133,
  LEFT_EYE_OUTER: 33,
  RIGHT_EYE_INNER: 362,
  RIGHT_EYE_OUTER: 263,

  // Nose bridge (for monocular PD split)
  NOSE_BRIDGE: 6,
  NOSE_TIP: 1,

  // Face outline for face shape detection
  FACE_OVAL: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
  ],

  // Forehead top
  FOREHEAD_TOP: 10,
  // Chin bottom
  CHIN_BOTTOM: 152,

  // Cheekbones (widest part of face)
  LEFT_CHEEKBONE: 234,
  RIGHT_CHEEKBONE: 454,

  // Jawline
  LEFT_JAW: 172,
  RIGHT_JAW: 397,

  // Temple (for frame width reference)
  LEFT_TEMPLE: 127,
  RIGHT_TEMPLE: 356,
};

export interface FaceLandmarks {
  x: number;
  y: number;
  z: number;
}

export interface CalibrationData {
  pixelsPerMm: number;
  referenceWidth: number; // mm
  referencePixelWidth: number; // px
  method: 'credit_card' | 'known_pd' | 'ruler' | 'lidar';
  timestamp: number;
}

export interface PDMeasurement {
  pdTotal: number;   // mm
  pdRight: number;   // mm (nose to right pupil)
  pdLeft: number;    // mm (nose to left pupil)
  confidence: number; // 0-1
  method: string;
}

export interface SegHeightMeasurement {
  segHeightRight: number; // mm
  segHeightLeft: number;  // mm
  ocHeightRight: number;  // mm
  ocHeightLeft: number;   // mm
  confidence: number;
}

export interface FaceGeometry {
  faceWidth: number;       // mm - widest point
  faceHeight: number;      // mm - forehead to chin
  jawWidth: number;        // mm
  cheekboneWidth: number;  // mm
  foreheadWidth: number;   // mm
  faceShape: 'oval' | 'round' | 'square' | 'heart' | 'oblong' | 'diamond';
  faceShapeConfidence: number;
  outlinePoints: { x: number; y: number }[]; // normalized face outline
  pdTotal: number;
  pdRight: number;
  pdLeft: number;
}

export class MeasurementService {
  // Credit card dimensions in mm (ISO/IEC 7810 ID-1)
  static readonly CREDIT_CARD_WIDTH_MM = 85.6;
  static readonly CREDIT_CARD_HEIGHT_MM = 53.98;

  // Average iris diameter for fallback calibration
  static readonly AVG_IRIS_DIAMETER_MM = 11.7;

  /**
   * Calibrate using a credit card placed next to face
   * Returns pixels-per-mm conversion factor
   */
  static calibrateWithCreditCard(
    cardLeftEdgeX: number,
    cardRightEdgeX: number,
    _imageWidth: number
  ): CalibrationData {
    const pixelWidth = Math.abs(cardRightEdgeX - cardLeftEdgeX);
    const pixelsPerMm = pixelWidth / this.CREDIT_CARD_WIDTH_MM;

    console.log(`[MeasurementService] Calibration: ${pixelsPerMm.toFixed(2)} px/mm (card width: ${pixelWidth}px)`);

    return {
      pixelsPerMm,
      referenceWidth: this.CREDIT_CARD_WIDTH_MM,
      referencePixelWidth: pixelWidth,
      method: 'credit_card',
      timestamp: Date.now()
    };
  }

  /**
   * Calibrate using iris diameter (less accurate but no reference object needed)
   * Uses average iris diameter of 11.7mm
   */
  static calibrateWithIris(landmarks: FaceLandmarks[], imageWidth: number): CalibrationData {
    const leftIris = LANDMARKS.LEFT_IRIS;
    const rightIris = LANDMARKS.RIGHT_IRIS;

    // Calculate average iris diameter in pixels
    const leftDiameter = this.getIrisDiameter(landmarks, leftIris, imageWidth);
    const rightDiameter = this.getIrisDiameter(landmarks, rightIris, imageWidth);
    const avgDiameter = (leftDiameter + rightDiameter) / 2;

    const pixelsPerMm = avgDiameter / this.AVG_IRIS_DIAMETER_MM;

    console.log(`[MeasurementService] Iris calibration: ${pixelsPerMm.toFixed(2)} px/mm (avg iris: ${avgDiameter.toFixed(1)}px)`);

    return {
      pixelsPerMm,
      referenceWidth: this.AVG_IRIS_DIAMETER_MM,
      referencePixelWidth: avgDiameter,
      method: 'credit_card', // label as generic for now
      timestamp: Date.now()
    };
  }

  private static getIrisDiameter(landmarks: FaceLandmarks[], irisIndices: number[], imageWidth: number): number {
    const center = landmarks[irisIndices[0]];
    let maxDist = 0;

    for (let i = 1; i < irisIndices.length; i++) {
      const point = landmarks[irisIndices[i]];
      const dx = (point.x - center.x) * imageWidth;
      const dy = (point.y - center.y) * imageWidth;
      const dist = Math.sqrt(dx * dx + dy * dy);
      maxDist = Math.max(maxDist, dist);
    }

    return maxDist * 2; // diameter = 2 * radius
  }

  /**
   * Calculate PD (pupillary distance) from face landmarks
   */
  static calculatePD(
    landmarks: FaceLandmarks[],
    calibration: CalibrationData,
    imageWidth: number,
    imageHeight: number
  ): PDMeasurement {
    // Use iris centers if available (Face Mesh v2 with iris)
    const hasIris = landmarks.length > 468;

    let leftPupilX: number, leftPupilY: number;
    let rightPupilX: number, rightPupilY: number;
    let confidence = 0.85;

    if (hasIris) {
      // Iris center landmarks (most accurate)
      leftPupilX = landmarks[LANDMARKS.LEFT_IRIS_CENTER].x * imageWidth;
      leftPupilY = landmarks[LANDMARKS.LEFT_IRIS_CENTER].y * imageHeight;
      rightPupilX = landmarks[LANDMARKS.RIGHT_IRIS_CENTER].x * imageWidth;
      rightPupilY = landmarks[LANDMARKS.RIGHT_IRIS_CENTER].y * imageHeight;
      confidence = 0.92;
    } else {
      // Fallback: midpoint of inner/outer eye corners
      leftPupilX = ((landmarks[LANDMARKS.LEFT_EYE_INNER].x + landmarks[LANDMARKS.LEFT_EYE_OUTER].x) / 2) * imageWidth;
      leftPupilY = ((landmarks[LANDMARKS.LEFT_EYE_INNER].y + landmarks[LANDMARKS.LEFT_EYE_OUTER].y) / 2) * imageHeight;
      rightPupilX = ((landmarks[LANDMARKS.RIGHT_EYE_INNER].x + landmarks[LANDMARKS.RIGHT_EYE_OUTER].x) / 2) * imageWidth;
      rightPupilY = ((landmarks[LANDMARKS.RIGHT_EYE_INNER].y + landmarks[LANDMARKS.RIGHT_EYE_OUTER].y) / 2) * imageHeight;
      confidence = 0.75;
    }

    // Total PD in pixels
    const pdPixels = Math.sqrt(
      Math.pow(rightPupilX - leftPupilX, 2) +
      Math.pow(rightPupilY - leftPupilY, 2)
    );

    // Convert to mm
    const pdMm = pdPixels / calibration.pixelsPerMm;

    // Monocular PD (distance from nose bridge to each pupil)
    const noseBridge = landmarks[LANDMARKS.NOSE_BRIDGE];
    const noseBridgeX = noseBridge.x * imageWidth;

    const pdRightPixels = Math.abs(rightPupilX - noseBridgeX);
    const pdLeftPixels = Math.abs(leftPupilX - noseBridgeX);

    const pdRight = pdRightPixels / calibration.pixelsPerMm;
    const pdLeft = pdLeftPixels / calibration.pixelsPerMm;

    // Sanity check: adult PD typically 54-74mm
    if (pdMm < 45 || pdMm > 80) {
      confidence *= 0.5; // Low confidence if outside normal range
    }

    // Round to 0.5mm
    const round05 = (v: number) => Math.round(v * 2) / 2;

    return {
      pdTotal: round05(pdMm),
      pdRight: round05(pdRight),
      pdLeft: round05(pdLeft),
      confidence: Math.round(confidence * 100) / 100,
      method: hasIris ? 'iris_detection' : 'eye_corner_estimation'
    };
  }

  /**
   * Calculate seg height and OC height from landmarks + frame markers
   */
  static calculateSegHeight(
    landmarks: FaceLandmarks[],
    frameBottomY: number, // normalized 0-1 Y position of frame bottom edge
    calibration: CalibrationData,
    _imageWidth: number,
    imageHeight: number
  ): SegHeightMeasurement {
    const hasIris = landmarks.length > 468;

    // Get pupil Y positions
    let leftPupilY: number, rightPupilY: number;

    if (hasIris) {
      leftPupilY = landmarks[LANDMARKS.LEFT_IRIS_CENTER].y;
      rightPupilY = landmarks[LANDMARKS.RIGHT_IRIS_CENTER].y;
    } else {
      leftPupilY = (landmarks[LANDMARKS.LEFT_EYE_INNER].y + landmarks[LANDMARKS.LEFT_EYE_OUTER].y) / 2;
      rightPupilY = (landmarks[LANDMARKS.RIGHT_EYE_INNER].y + landmarks[LANDMARKS.RIGHT_EYE_OUTER].y) / 2;
    }

    // Seg height = distance from pupil center to frame bottom (in mm)
    const segRightPixels = Math.abs(frameBottomY - rightPupilY) * imageHeight;
    const segLeftPixels = Math.abs(frameBottomY - leftPupilY) * imageHeight;

    const segRight = segRightPixels / calibration.pixelsPerMm;
    const segLeft = segLeftPixels / calibration.pixelsPerMm;

    // OC height = seg height + 1-2mm (standard offset)
    const ocRight = segRight + 1.5;
    const ocLeft = segLeft + 1.5;

    const round05 = (v: number) => Math.round(v * 2) / 2;

    return {
      segHeightRight: round05(segRight),
      segHeightLeft: round05(segLeft),
      ocHeightRight: round05(ocRight),
      ocHeightLeft: round05(ocLeft),
      confidence: hasIris ? 0.88 : 0.70
    };
  }

  /**
   * Extract face geometry for face shape classification and virtual try-on
   * This creates a geometric representation (not a photo) of the face
   */
  static extractFaceGeometry(
    landmarks: FaceLandmarks[],
    calibration: CalibrationData,
    imageWidth: number,
    imageHeight: number
  ): FaceGeometry {
    // Face dimensions
    const forehead = landmarks[LANDMARKS.FOREHEAD_TOP];
    const chin = landmarks[LANDMARKS.CHIN_BOTTOM];
    const leftCheek = landmarks[LANDMARKS.LEFT_CHEEKBONE];
    const rightCheek = landmarks[LANDMARKS.RIGHT_CHEEKBONE];
    const leftJaw = landmarks[LANDMARKS.LEFT_JAW];
    const rightJaw = landmarks[LANDMARKS.RIGHT_JAW];
    const leftTemple = landmarks[LANDMARKS.LEFT_TEMPLE];
    const rightTemple = landmarks[LANDMARKS.RIGHT_TEMPLE];

    // Calculate distances in mm
    const faceHeightPx = Math.abs(chin.y - forehead.y) * imageHeight;
    const cheekWidthPx = Math.abs(rightCheek.x - leftCheek.x) * imageWidth;
    const jawWidthPx = Math.abs(rightJaw.x - leftJaw.x) * imageWidth;
    const foreheadWidthPx = Math.abs(rightTemple.x - leftTemple.x) * imageWidth;
    const faceWidthPx = Math.max(cheekWidthPx, jawWidthPx, foreheadWidthPx);

    const faceHeight = faceHeightPx / calibration.pixelsPerMm;
    const cheekboneWidth = cheekWidthPx / calibration.pixelsPerMm;
    const jawWidth = jawWidthPx / calibration.pixelsPerMm;
    const foreheadWidth = foreheadWidthPx / calibration.pixelsPerMm;
    const faceWidth = faceWidthPx / calibration.pixelsPerMm;

    // Get PD
    const pd = this.calculatePD(landmarks, calibration, imageWidth, imageHeight);

    // Extract face outline (normalized 0-1 coordinates centered on face)
    const outlinePoints = LANDMARKS.FACE_OVAL.map(idx => {
      const pt = landmarks[idx];
      // Normalize relative to face center
      const centerX = (leftCheek.x + rightCheek.x) / 2;
      const centerY = (forehead.y + chin.y) / 2;
      return {
        x: (pt.x - centerX) / (faceWidth / imageWidth),
        y: (pt.y - centerY) / (faceHeight / imageHeight)
      };
    });

    // Classify face shape
    const { shape, confidence } = this.classifyFaceShape(
      faceWidth, faceHeight, cheekboneWidth, jawWidth, foreheadWidth
    );

    return {
      faceWidth: Math.round(faceWidth * 10) / 10,
      faceHeight: Math.round(faceHeight * 10) / 10,
      jawWidth: Math.round(jawWidth * 10) / 10,
      cheekboneWidth: Math.round(cheekboneWidth * 10) / 10,
      foreheadWidth: Math.round(foreheadWidth * 10) / 10,
      faceShape: shape,
      faceShapeConfidence: confidence,
      outlinePoints,
      pdTotal: pd.pdTotal,
      pdRight: pd.pdRight,
      pdLeft: pd.pdLeft
    };
  }

  /**
   * Classify face shape based on proportions
   */
  private static classifyFaceShape(
    faceWidth: number,
    faceHeight: number,
    cheekboneWidth: number,
    jawWidth: number,
    foreheadWidth: number
  ): { shape: FaceGeometry['faceShape']; confidence: number } {
    const ratio = faceHeight / faceWidth;
    const jawToForehead = jawWidth / foreheadWidth;
    const cheekToJaw = cheekboneWidth / jawWidth;

    // Classification rules based on facial proportions
    // Oval: slightly longer than wide, cheekbones widest, jaw narrower
    if (ratio > 1.2 && ratio < 1.5 && cheekToJaw > 1.05 && jawToForehead < 0.95) {
      return { shape: 'oval', confidence: 0.85 };
    }

    // Round: nearly equal width and height, soft jawline
    if (ratio >= 0.9 && ratio <= 1.2 && cheekToJaw < 1.1 && jawToForehead > 0.85) {
      return { shape: 'round', confidence: 0.80 };
    }

    // Square: equal width and height, strong jawline
    if (ratio >= 0.9 && ratio <= 1.2 && jawToForehead > 0.9 && cheekToJaw < 1.05) {
      return { shape: 'square', confidence: 0.78 };
    }

    // Heart: wider forehead, narrow jaw
    if (jawToForehead < 0.8 && cheekToJaw > 1.1) {
      return { shape: 'heart', confidence: 0.82 };
    }

    // Oblong: much longer than wide
    if (ratio > 1.5) {
      return { shape: 'oblong', confidence: 0.80 };
    }

    // Diamond: cheekbones widest, narrow forehead and jaw
    if (cheekToJaw > 1.15 && jawToForehead > 0.9) {
      return { shape: 'diamond', confidence: 0.75 };
    }

    // Default to oval
    return { shape: 'oval', confidence: 0.50 };
  }

  /**
   * Generate SVG representation of face geometry for patient profile
   * This creates a geometric wireframe, NOT a photo
   */
  static generateFaceSVG(geometry: FaceGeometry, width = 200, height = 280): string {
    const cx = width / 2;
    const cy = height / 2;
    const scale = Math.min(width, height) / 3;

    // Build SVG face outline path
    const outlinePath = geometry.outlinePoints.map((pt, i) => {
      const x = cx + pt.x * scale;
      const y = cy + pt.y * scale;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ') + ' Z';

    // Pupil positions (approximate from PD)
    const pdScale = geometry.pdTotal / geometry.faceWidth;
    const leftPupilX = cx - (pdScale * scale * 0.5);
    const rightPupilX = cx + (pdScale * scale * 0.5);
    const pupilY = cy - scale * 0.1; // slightly above center

    // Measurements text
    const measurements = [
      `PD: ${geometry.pdTotal}mm (R:${geometry.pdRight} / L:${geometry.pdLeft})`,
      `Face: ${geometry.faceWidth}mm x ${geometry.faceHeight}mm`,
      `Shape: ${geometry.faceShape}`
    ];

    return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="faceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#e8f4fd;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#d1ecf9;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Face outline -->
  <path d="${outlinePath}" fill="url(#faceGrad)" stroke="#4a90d9" stroke-width="1.5" />
  
  <!-- Center line -->
  <line x1="${cx}" y1="${cy - scale}" x2="${cx}" y2="${cy + scale}" stroke="#ccc" stroke-width="0.5" stroke-dasharray="3,3" />
  
  <!-- PD line -->
  <line x1="${leftPupilX}" y1="${pupilY}" x2="${rightPupilX}" y2="${pupilY}" stroke="#e74c3c" stroke-width="1" />
  <line x1="${leftPupilX}" y1="${pupilY - 4}" x2="${leftPupilX}" y2="${pupilY + 4}" stroke="#e74c3c" stroke-width="1" />
  <line x1="${rightPupilX}" y1="${pupilY - 4}" x2="${rightPupilX}" y2="${pupilY + 4}" stroke="#e74c3c" stroke-width="1" />
  
  <!-- Pupils -->
  <circle cx="${leftPupilX}" cy="${pupilY}" r="4" fill="#2c3e50" />
  <circle cx="${rightPupilX}" cy="${pupilY}" r="4" fill="#2c3e50" />
  <circle cx="${leftPupilX}" cy="${pupilY}" r="2" fill="#4a90d9" />
  <circle cx="${rightPupilX}" cy="${pupilY}" r="2" fill="#4a90d9" />
  
  <!-- Nose -->
  <circle cx="${cx}" cy="${pupilY + scale * 0.3}" r="2" fill="#ccc" />
  
  <!-- Measurements -->
  ${measurements.map((text, i) => 
    `<text x="${cx}" y="${height - 30 + i * 12}" text-anchor="middle" font-size="8" fill="#666">${text}</text>`
  ).join('\n  ')}
</svg>`;
  }
}
