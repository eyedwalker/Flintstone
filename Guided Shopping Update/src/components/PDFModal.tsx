import { Printer } from 'lucide-react';
import { Modal } from './Modal';

interface PDFModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl: string;
  title?: string;
}

export function PDFModal({ isOpen, onClose, pdfUrl, title }: PDFModalProps) {
  const handlePrint = () => {
    const iframe = document.getElementById('pdf-iframe') as HTMLIFrameElement;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.print();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title || 'PDF Document'} size="full">
      <div className="p-4">
        <div className="flex justify-end mb-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>
        <iframe
          id="pdf-iframe"
          src={pdfUrl}
          className="w-full h-[80vh] border"
          title="PDF Viewer"
        />
      </div>
    </Modal>
  );
}
