export type DatePreset = "daily" | "weekly" | "monthly" | "custom";

interface DateRangePickerProps {
  datePreset: DatePreset;
  setDatePreset: (preset: DatePreset) => void;
  customStart: string;
  setCustomStart: (v: string) => void;
  customEnd: string;
  setCustomEnd: (v: string) => void;
  customStartTime: string;
  setCustomStartTime: (v: string) => void;
  customEndTime: string;
  setCustomEndTime: (v: string) => void;
  onApplyCustom: () => void;
  dateLabel: string;
}

export function DateRangePicker({
  datePreset,
  setDatePreset,
  customStart,
  setCustomStart,
  customEnd,
  setCustomEnd,
  customStartTime,
  setCustomStartTime,
  customEndTime,
  setCustomEndTime,
  onApplyCustom,
  dateLabel,
}: DateRangePickerProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["daily", "weekly", "monthly", "custom"] as DatePreset[]).map(
          (preset) => (
            <button
              key={preset}
              onClick={() => setDatePreset(preset)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                datePreset === preset
                  ? "bg-kaart-orange text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {preset.charAt(0).toUpperCase() + preset.slice(1)}
            </button>
          ),
        )}
      </div>

      {datePreset === "custom" && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm text-muted-foreground">From</label>
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="px-3 py-1.5 border border-input rounded-lg text-sm"
          />
          <input
            type="time"
            value={customStartTime}
            onChange={(e) => setCustomStartTime(e.target.value)}
            className="px-2 py-1.5 border border-input rounded-lg text-sm"
          />
          <label className="text-sm text-muted-foreground">To</label>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="px-3 py-1.5 border border-input rounded-lg text-sm"
          />
          <input
            type="time"
            value={customEndTime}
            onChange={(e) => setCustomEndTime(e.target.value)}
            className="px-2 py-1.5 border border-input rounded-lg text-sm"
          />
          <button
            onClick={onApplyCustom}
            disabled={!customStart || !customEnd}
            className="px-3 py-1.5 bg-kaart-orange text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}

      {dateLabel && (
        <p className="text-sm text-muted-foreground">Showing: {dateLabel}</p>
      )}
    </div>
  );
}
