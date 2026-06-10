import { HashtagChip } from "@/components/atoms/HashtagChip";
import { TablePaginator } from "@/components/tables/TablePaginator";
import { formatDateTime } from "@/lib/utils";
import { openChangesetInJosm, zoomToChangeset } from "@/lib/josmRemoteControl";
import type { Changeset } from "@/types";

const ROWS_PER_PAGE = 20;

interface ChangesetTableProps {
  changesets: Changeset[];
  page: number;
  setPage: (updater: (p: number) => number) => void;
  followInJosm: boolean;
  lastFollowedId: number | null;
  setLastFollowedId: (id: number | null) => void;
}

export function ChangesetTable({
  changesets,
  page,
  setPage,
  followInJosm,
  lastFollowedId,
  setLastFollowedId,
}: ChangesetTableProps) {
  const displayed = changesets.slice(
    (page - 1) * ROWS_PER_PAGE,
    page * ROWS_PER_PAGE,
  );

  if (displayed.length === 0) return null;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 500 }}>
          <thead className="bg-muted border-b border-border">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Changeset
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Date
              </th>
              <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                Changes
              </th>
              <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                +Add
              </th>
              <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                ~Mod
              </th>
              <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                -Del
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Comment
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Hashtags
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {displayed.map((cs) => {
              const canZoomJosm = cs.centroid !== null;
              const handleRowClick = () => {
                if (!followInJosm) return;
                if (lastFollowedId === cs.id) return;
                setLastFollowedId(cs.id);
                zoomToChangeset(cs).catch(() => {});
              };
              return (
                <tr
                  key={cs.id}
                  onClick={handleRowClick}
                  className={
                    followInJosm && lastFollowedId === cs.id
                      ? "bg-kaart-orange/5"
                      : undefined
                  }
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{cs.id}
                      </span>
                      <a
                        href={`https://www.openstreetmap.org/changeset/${cs.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Open on OpenStreetMap"
                        className="inline-flex items-center justify-center w-6 h-6 rounded border border-border text-muted-foreground hover:text-kaart-orange hover:border-kaart-orange transition-colors"
                        aria-label="Open changeset on OpenStreetMap"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="w-3.5 h-3.5"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M2 12h20" />
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                      </a>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!canZoomJosm) return;
                          openChangesetInJosm(cs).catch(() => {});
                        }}
                        disabled={!canZoomJosm}
                        title={
                          canZoomJosm
                            ? "Open in JOSM (requires Remote Control enabled)"
                            : "No bounding box available — JOSM open disabled"
                        }
                        className="inline-flex items-center justify-center w-6 h-6 rounded border border-border text-muted-foreground hover:text-kaart-orange hover:border-kaart-orange transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:border-border"
                        aria-label="Open changeset in JOSM"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="w-3.5 h-3.5"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                      </button>
                      <a
                        href={`https://osmcha.org/changesets/${cs.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Review on OSMCha"
                        className="inline-flex items-center justify-center w-6 h-6 rounded border border-border text-muted-foreground hover:text-kaart-orange hover:border-kaart-orange transition-colors"
                        aria-label="Review changeset on OSMCha"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="w-3.5 h-3.5"
                        >
                          <path d="M21 21l-6-6" />
                          <circle cx="10" cy="10" r="7" />
                        </svg>
                      </a>
                    </div>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {formatDateTime(cs.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {cs.changesCount}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-green-600">
                    {cs.added ?? "-"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-yellow-600">
                    {cs.modified ?? "-"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-red-500">
                    {cs.deleted ?? "-"}
                  </td>
                  <td className="px-4 py-2 max-w-xs truncate">
                    {cs.comment || "-"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {cs.hashtags.map((tag) => (
                        <HashtagChip key={tag} tag={tag} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {changesets.length > ROWS_PER_PAGE && (
        <TablePaginator
          page={page}
          totalItems={changesets.length}
          pageSize={ROWS_PER_PAGE}
          onPrev={() => setPage((p) => p - 1)}
          onNext={() => setPage((p) => p + 1)}
        />
      )}
    </>
  );
}
