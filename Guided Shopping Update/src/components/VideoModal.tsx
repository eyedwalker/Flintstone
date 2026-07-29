import { Modal } from './Modal';

interface VideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoType: 'youtube' | 'vimeo';
  videoId: string;
  title?: string;
}

export function VideoModal({ isOpen, onClose, videoType, videoId, title }: VideoModalProps) {
  const getEmbedUrl = () => {
    if (videoType === 'youtube') {
      return `https://www.youtube.com/embed/${videoId}?autoplay=1`;
    }
    return `https://player.vimeo.com/video/${videoId}?autoplay=1`;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title || 'Video'} size="xl">
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <iframe
          className="absolute top-0 left-0 w-full h-full"
          src={getEmbedUrl()}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </Modal>
  );
}
