import { Val } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { UserProfileData } from "@/types";

interface UserInfoGridProps {
  user: UserProfileData;
}

export function UserInfoGrid({ user }: UserInfoGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
      <div className="border border-border rounded-lg p-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Accounts
        </p>
        <div className="space-y-1.5">
          {user.email && (
            <div>
              <span className="text-xs text-muted-foreground">Email</span>
              <p className="text-sm">{user.email}</p>
            </div>
          )}
          {user.osm_username && (
            <div>
              <span className="text-xs text-muted-foreground">OSM</span>
              <p className="text-sm">
                <a
                  href={`https://www.openstreetmap.org/user/${user.osm_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-kaart-orange hover:underline"
                >
                  {user.osm_username}
                </a>
              </p>
            </div>
          )}
          {user.mapillary_username && (
            <div>
              <span className="text-xs text-muted-foreground">Mapillary</span>
              <p className="text-sm">
                <a
                  href={`https://www.mapillary.com/app/user/${user.mapillary_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-kaart-orange hover:underline"
                >
                  {user.mapillary_username}
                </a>
              </p>
            </div>
          )}
          {user.payment_email && (
            <div>
              <span className="text-xs text-muted-foreground">
                Payment Email
              </span>
              <p className="text-sm">{user.payment_email}</p>
            </div>
          )}
          {user.hourly_rate != null && (
            <div>
              <span className="text-xs text-muted-foreground">Hourly Rate</span>
              <p className="text-sm">
                <Val>{formatCurrency(user.hourly_rate)}</Val>/hr
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="border border-border rounded-lg p-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Location
        </p>
        <div className="space-y-1.5">
          <div>
            <span className="text-xs text-muted-foreground">Country</span>
            <p className="text-sm">
              {user.country_name || user.country || "Not set"}
            </p>
          </div>
          {user.region_name && (
            <div>
              <span className="text-xs text-muted-foreground">Region</span>
              <p className="text-sm">{user.region_name}</p>
            </div>
          )}
          <div>
            <span className="text-xs text-muted-foreground">Timezone</span>
            <p className="text-sm">{user.timezone || "Not set"}</p>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg p-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Stats
        </p>
        <div className="space-y-1.5">
          <div>
            <span className="text-xs text-muted-foreground">Joined</span>
            <p className="text-sm">
              {user.joined ? formatDate(user.joined) : "Unknown"}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">
              Mapper Points
            </span>
            <p className="text-sm font-medium">{user.mapper_points ?? 0}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">
              Validator Points
            </span>
            <p className="text-sm font-medium">{user.validator_points ?? 0}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
