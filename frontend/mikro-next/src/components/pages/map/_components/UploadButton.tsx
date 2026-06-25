interface UploadButtonProps {
  uploading: boolean;
  fileInput: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function UploadButton({
  uploading,
  fileInput,
  onUpload,
}: UploadButtonProps) {
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".geojson,.json"
        onChange={onUpload}
        className="hidden"
      />
      <button
        onClick={() => fileInput.current?.click()}
        disabled={uploading}
        title="Upload GeoJSON"
        aria-label="Upload GeoJSON"
        className="absolute top-2.5 right-14 z-10 w-9 h-9 flex items-center justify-center rounded-md bg-white text-gray-800 border border-gray-300 shadow-md hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        {uploading ? (
          <span className="block w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        )}
      </button>
    </>
  );
}
