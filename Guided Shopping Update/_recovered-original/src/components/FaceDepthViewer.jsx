import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

/**
 * 3D Face Depth Map Viewer Component
 * Renders a 3D visualization of the face using depth map data from head movement calibration
 */
export function FaceDepthViewer({ depthMap, landmarks, width = 300, height = 300, colorScale = 'rainbow' }) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const meshRef = useRef(null);
  const controlsRef = useRef(null);
  const animationRef = useRef(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Initialize the 3D scene
  useEffect(() => {
    if (!containerRef.current || !depthMap || !landmarks || Object.keys(depthMap).length === 0) {
      return;
    }
    
    try {
      // Create scene, camera, renderer
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf5f5f5);
      sceneRef.current = scene;
      
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
      camera.position.z = 25;
      cameraRef.current = camera;
      
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      containerRef.current.appendChild(renderer.domElement);
      rendererRef.current = renderer;
      
      // Add ambient and directional light
      const ambientLight = new THREE.AmbientLight(0x404040, 1);
      scene.add(ambientLight);
      
      const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight.position.set(0, 1, 1).normalize();
      scene.add(directionalLight);
      
      // Add orbit controls
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.25;
      controls.enableZoom = true;
      controlsRef.current = controls;
      
      // Create the face mesh from landmarks and depth map
      createFaceMesh();
      
      // Animation loop
      const animate = () => {
        animationRef.current = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      
      animate();
      setIsLoading(false);
      
      // Cleanup function
      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
        
        if (rendererRef.current && containerRef.current) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
        
        if (meshRef.current) {
          scene.remove(meshRef.current);
          meshRef.current.geometry.dispose();
          meshRef.current.material.dispose();
        }
      };
    } catch (err) {
      console.error('Error initializing 3D viewer:', err);
      setError('Failed to initialize 3D viewer');
    }
  }, [depthMap, landmarks, width, height]);
  
  // Create face mesh from landmarks and depth map
  const createFaceMesh = () => {
    if (!depthMap || !landmarks || !sceneRef.current) return;
    
    try {
      // Remove any existing mesh
      if (meshRef.current) {
        sceneRef.current.remove(meshRef.current);
        meshRef.current.geometry.dispose();
        meshRef.current.material.dispose();
      }
      
      // Create geometry for the face mesh
      const geometry = new THREE.BufferGeometry();
      const vertices = [];
      const colors = [];
      const indices = [];
      const colorMaps = {
        rainbow: [
          new THREE.Color(0x0000ff), // Blue - furthest
          new THREE.Color(0x00ffff), // Cyan
          new THREE.Color(0x00ff00), // Green
          new THREE.Color(0xffff00), // Yellow
          new THREE.Color(0xff0000)  // Red - closest
        ],
        grayscale: [
          new THREE.Color(0x222222), // Dark gray - furthest
          new THREE.Color(0x666666), // Medium gray
          new THREE.Color(0xAAAAAA), // Light gray
          new THREE.Color(0xEEEEEE)  // Almost white - closest
        ],
        skin: [
          new THREE.Color(0xa65c42), // Dark skin
          new THREE.Color(0xc68642), // Medium skin
          new THREE.Color(0xf1c27d), // Light skin
          new THREE.Color(0xffdbac)  // Very light skin
        ]
      };
      
      // Use chosen color scale or default to rainbow
      const colorMap = colorMaps[colorScale] || colorMaps.rainbow;
      
      // Create face mesh using triangulation of key landmarks
      const faceOvalIndices = [
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 
        397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 
        172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
      ];
      
      // Add face oval points as vertices
      faceOvalIndices.forEach(idx => {
        const landmark = landmarks[idx];
        if (!landmark) return;
        
        // Apply depth from depth map or use default
        const depth = depthMap[idx] || 0.5;
        // Scale depth for visualization (multiply by 5 to make differences more visible)
        const depthValue = 5 * (1 - depth); // Invert so closer points protrude more
        
        // Add vertex with depth applied along z-axis
        // Scale and center the mesh
        vertices.push(
          (landmark.x - 0.5) * 20,  // Scale x from [0,1] to [-10,10] 
          -(landmark.y - 0.5) * 20, // Scale y from [0,1] to [-10,10] and invert (y is down in video)
          -depthValue               // Apply depth along negative z-axis
        );
        
        // Color based on depth
        const colorIdx = Math.min(colorMap.length - 1, Math.floor(depth * colorMap.length));
        const color = colorMap[colorIdx];
        colors.push(color.r, color.g, color.b);
      });
      
      // Add interior face landmarks for better density
      const interiorIndices = [
        // Eyes
        33, 160, 158, 133, 153, 144, 163, 7, 173, 159, 
        263, 390, 388, 466, 263, 249, 390, 373, 374, 380,
        // Nose
        2, 98, 327, 331, 
        // Mouth
        61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
        // Eyebrows
        70, 63, 105, 66, 107, 336, 296, 334, 293, 300
      ];
      
      interiorIndices.forEach(idx => {
        const landmark = landmarks[idx];
        if (!landmark) return;
        
        const depth = depthMap[idx] || 0.5;
        const depthValue = 5 * (1 - depth);
        
        vertices.push(
          (landmark.x - 0.5) * 20,
          -(landmark.y - 0.5) * 20,
          -depthValue
        );
        
        const colorIdx = Math.min(colorMap.length - 1, Math.floor(depth * colorMap.length));
        const color = colorMap[colorIdx];
        colors.push(color.r, color.g, color.b);
      });
      
      // Create a basic triangulation for the face
      // This is simplified - a proper mesh would use Delaunay triangulation
      for (let i = 1; i < faceOvalIndices.length - 1; i++) {
        indices.push(0, i, i + 1);
      }
      
      // Set up the geometry attributes
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      
      // Create material and mesh
      const material = new THREE.MeshPhongMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        shininess: 50,
        flatShading: true
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      sceneRef.current.add(mesh);
      meshRef.current = mesh;
      
      // Center the camera on the face
      mesh.rotation.y = Math.PI; // Rotate to face camera
      
    } catch (err) {
      console.error('Error creating face mesh:', err);
      setError('Failed to create face visualization');
    }
  };
  
  // Handle color scale change
  useEffect(() => {
    if (depthMap && landmarks) {
      createFaceMesh();
    }
  }, [colorScale]);
  
  return (
    <div className="face-depth-viewer">
      {error && (
        <div className="error-message text-red-500 text-sm mb-2">{error}</div>
      )}
      
      {isLoading && !error && (
        <div className="loading text-gray-500 text-sm mb-2">
          Loading 3D visualization...
        </div>
      )}
      
      <div 
        ref={containerRef} 
        className="face-depth-viewer-container relative" 
        style={{ 
          width: `${width}px`, 
          height: `${height}px`,
          backgroundColor: '#f5f5f5',
          borderRadius: '8px',
          overflow: 'hidden'
        }}
      >
        {!depthMap || Object.keys(depthMap).length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            No 3D data available
          </div>
        ) : null}
      </div>
      
      <div className="controls mt-2 text-xs text-gray-500">
        Drag to rotate • Scroll to zoom
      </div>
    </div>
  );
}

export default FaceDepthViewer;
