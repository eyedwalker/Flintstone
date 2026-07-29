import { Modal } from './Modal';

interface ImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  title?: string;
}

export function ImageModal({ isOpen, onClose, imageUrl, title }: ImageModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title || 'Image'} size="xl">
      <div className="p-4">
        <img
          src={imageUrl}
          alt={title}
          className="w-full h-auto max-h-[80vh] object-contain"
        />
      </div>
    </Modal>
  );
}
