export interface HeadMovementGuideProps {
  currentMovement: string;
  headPose: { yaw: number; pitch: number; roll: number };
  targetPose: { yaw: number; pitch: number; roll: number };
  onMovementComplete: (movement: string) => void;
  isRecording: boolean;
}

export function HeadMovementGuide(props: HeadMovementGuideProps): JSX.Element;
