import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, wide }: ModalProps) {
  useEffect(() => {
    if (open) {
      const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`relative max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl ${wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
