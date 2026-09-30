/**
 * Dialog shell for search, settings, help and the logbook: scrim, focus trap, restore focus on close.
 * Escape is handled once for the whole overlay (App), because the engine listens for it too.
 */
import type { ReactNode } from 'react';
import { useFocusTrap } from '../hooks';
import './parts.css';

export type ModalVariant = 'center' | 'top' | 'left';

interface ModalProps {
  onClose: () => void;
  labelledBy: string;
  variant?: ModalVariant;
  className?: string;
  children: ReactNode;
}

export function Modal({ onClose, labelledBy, variant = 'center', className, children }: ModalProps) {
  const ref = useFocusTrap<HTMLDivElement>(true);
  return (
    <div className="sd-modal" data-variant={variant} data-sd-interactive>
      <div className="sd-modal__scrim" onPointerDown={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`sd-modal__dialog sd-panel sd-ticked${className ? ` ${className}` : ''}`}
      >
        {children}
      </div>
    </div>
  );
}
