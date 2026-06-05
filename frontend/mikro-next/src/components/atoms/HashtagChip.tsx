interface HashtagChipProps {
  tag: string;
}

export function HashtagChip({ tag }: HashtagChipProps) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700">
      {tag}
    </span>
  );
}
