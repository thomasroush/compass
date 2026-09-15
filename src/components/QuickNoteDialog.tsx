import { useEffect } from 'react';
import { QuickNoteInput } from './QuickNoteInput';

interface QuickNoteDialogProps {
  onClose: () => void;
}

/**
 * The top-bar "Quick Note" action (requirement 10): a lightweight dialog
 * available from anywhere in Compass, reusing the same input and save
 * behavior as the Today view's embedded section (QuickNoteInput). Closes
 * itself automatically once a note is added, so capturing a reminder never
 * requires more than typing it and pressing Enter (or tapping Add).
 */
export function QuickNoteDialog({ onClose }: QuickNoteDialogProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-note-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="quick-note-dialog-title">Quick Note</h2>
        <QuickNoteInput autoFocus onAdded={onClose} />
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
