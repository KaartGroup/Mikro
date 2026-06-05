interface HashtagSummaryProps {
  hashtags: Record<string, number>;
}

export function HashtagSummary({ hashtags }: HashtagSummaryProps) {
  const sorted = Object.entries(hashtags).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) return null;

  return (
    <div>
      <h4 className="text-sm font-semibold text-muted-foreground mb-2">
        Hashtag Summary
      </h4>
      <div className="flex flex-wrap gap-2">
        {sorted.map(([tag, count]) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200"
          >
            {tag}
            <span className="font-bold">({count})</span>
          </span>
        ))}
      </div>
    </div>
  );
}
