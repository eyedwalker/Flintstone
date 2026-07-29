import { useState, useRef, useEffect } from 'react';

interface BeforeAfterSliderProps {
  beforeImage: string;
  afterImage: string;
  beforeLabel?: string;
  afterLabel?: string;
  beforeEffect?: string;
  afterEffect?: string;
}

export function BeforeAfterSlider({
  beforeImage,
  afterImage,
  beforeLabel = 'Without Treatment',
  afterLabel = 'With Treatment',
  beforeEffect = '',
  afterEffect = ''
}: BeforeAfterSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = (x / rect.width) * 100;
    
    setSliderPosition(Math.max(0, Math.min(100, percentage)));
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      handleMove(e.clientX);
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (isDragging && e.touches[0]) {
      handleMove(e.touches[0].clientX);
    }
  };

  const handleStart = () => {
    setIsDragging(true);
  };

  const handleEnd = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleEnd);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleEnd);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleEnd);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleEnd);
      };
    }
  }, [isDragging]);

  return (
    <div className="relative w-full h-full select-none" ref={containerRef}>
      {/* Before Image (Left Side) */}
      <div className="absolute inset-0">
        <img
          src={beforeImage}
          alt={beforeLabel}
          className={`w-full h-full object-cover ${beforeEffect}`}
          draggable={false}
        />
        <div className="absolute bottom-4 left-4 bg-black bg-opacity-70 text-white px-3 py-1.5 rounded text-sm font-medium">
          {beforeLabel}
        </div>
      </div>

      {/* After Image (Right Side) with Clip */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}
      >
        <img
          src={afterImage}
          alt={afterLabel}
          className={`w-full h-full object-cover ${afterEffect}`}
          draggable={false}
        />
        <div className="absolute bottom-4 right-4 bg-black bg-opacity-70 text-white px-3 py-1.5 rounded text-sm font-medium">
          {afterLabel}
        </div>
      </div>

      {/* Slider Handle */}
      <div
        className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize"
        style={{ left: `${sliderPosition}%` }}
        onMouseDown={handleStart}
        onTouchStart={handleStart}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center">
          <div className="flex gap-0.5">
            <div className="w-0.5 h-4 bg-gray-600"></div>
            <div className="w-0.5 h-4 bg-gray-600"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
