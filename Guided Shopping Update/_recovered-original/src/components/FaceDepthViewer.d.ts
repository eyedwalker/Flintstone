export interface FaceDepthViewerProps {
  depthMap: Record<string, { x: number; y: number; z: number }> | any;
  landmarks: any;
  width?: number;
  height?: number;
  colorScale?: string;
}

export function FaceDepthViewer(props: FaceDepthViewerProps): JSX.Element;
