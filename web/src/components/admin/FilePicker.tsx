import React, { useState } from 'react';
import { CheckCircle2, Upload } from 'lucide-react';

interface FilePickerProps {
  label: string;
  required?: boolean;
  accept?: string;
  file: File | null;
  onFile: (f: File | null) => void;
  // Optional inline hint rendered under the file info.
  hint?: React.ReactNode;
  // Optional accept predicate for friendlier error messages than the
  // browser's native "this file type is not allowed".
  validate?: (f: File) => string | null;
  // Hard size limit in bytes — enforced in addition to any outer cap.
  maxBytes?: number;
}

/**
 * Drag-and-drop file picker shared by the admin upload modals.
 * Displays the file name + size on select, hint text otherwise.
 */
export function FilePicker({
  label,
  required,
  accept,
  file,
  onFile,
  hint,
  validate,
  maxBytes,
}: FilePickerProps) {
  const [dragging, setDragging] = useState(false);

  const acceptFile = (f: File | null) => {
    if (!f) {
      onFile(null);
      return;
    }
    if (validate) {
      const err = validate(f);
      if (err) {
        alert(err);
        return;
      }
    }
    if (maxBytes && f.size > maxBytes) {
      alert(
        `File too large. Max ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`
      );
      return;
    }
    onFile(f);
  };

  return (
    <div>
      <label
        className="text-[10px] uppercase tracking-[0.2em] mb-2 inline-block"
        style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
        {required && (
          <span style={{ color: 'var(--color-accent)', marginLeft: 4 }}>*</span>
        )}
      </label>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          acceptFile(e.dataTransfer.files?.[0] ?? null);
        }}
        className="block rounded-2xl p-6 text-center cursor-pointer transition-colors"
        style={{
          background: dragging
            ? 'rgba(168, 128, 107, 0.10)'
            : file
              ? 'rgba(168, 128, 107, 0.06)'
              : 'rgba(247, 244, 236, 0.5)',
          border: dragging
            ? '2px dashed var(--color-accent)'
            : '2px dashed rgba(26, 24, 20, 0.10)',
        }}
      >
        <input
          type="file"
          accept={accept}
          required={required}
          className="hidden"
          onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--color-accent)' }} />
            <div className="text-left">
              <p className="text-sm" style={{ color: 'var(--color-fg)' }}>{file.name}</p>
              <p className="text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>
        ) : (
          <>
            <Upload className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--color-fg-faint)' }} />
            <p className="text-xs" style={{ color: 'var(--color-fg-soft)' }}>
              Drop a file here, or click to browse
            </p>
          </>
        )}
      </label>
      {hint && (
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-fg-faint)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
