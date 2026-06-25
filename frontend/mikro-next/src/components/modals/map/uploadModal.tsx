"use client";

import { useState } from "react";
import { Modal, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useUpload } from "@/components/pages/map/hooks/useUpload";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Single entry point for adding data to the map. Wraps the shared upload
 * behaviour (`useUpload`) in a modal with a clickable / drag-and-drop zone and
 * closes itself once the upload succeeds.
 */
export default function UploadModal({ isOpen, onClose }: UploadModalProps) {
  const { uploading, fileInput, handleUpload, open } = useUpload();
  const [dragging, setDragging] = useState(false);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const ok = await handleUpload(e);
    if (ok) onClose();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const input = fileInput.current;
    const file = e.dataTransfer.files?.[0];
    if (!input || !file) return;
    // Route dropped files through the same hidden input so handleUpload's
    // `e.target` (file reading + reset) behaves exactly as on a normal pick.
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    upload({ target: input } as React.ChangeEvent<HTMLInputElement>);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Data"
      description="Upload a GeoJSON file to add it as a layer."
      footer={
        <Button variant="outline" onClick={onClose} disabled={uploading}>
          Cancel
        </Button>
      }
    >
      <input
        ref={fileInput}
        type="file"
        accept=".geojson,.json"
        onChange={upload}
        className="hidden"
      />
      <button
        type="button"
        onClick={open}
        disabled={uploading}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-60",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/60 hover:bg-muted/40",
        )}
      >
        {uploading ? (
          <span className="block h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        ) : (
          <>
            <span className="text-sm font-medium text-foreground">
              Click to choose a file or drag it here
            </span>
            <span className="text-xs text-muted-foreground">
              GeoJSON (.geojson, .json)
            </span>
          </>
        )}
      </button>
    </Modal>
  );
}
