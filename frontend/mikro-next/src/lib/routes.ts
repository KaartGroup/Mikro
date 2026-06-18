/** Central registry of all internal app routes. Each entry must have a page.tsx. */
export const ROUTES = {
  // Root
  home: "/",

  // Authenticated — user-facing
  account: "/account",
  dashboard: "/dashboard",
  messages: "/messages",
  onboarding: "/onboarding",
  projects: "/projects",
  reports: "/reports",
  teams: "/teams",
  training: "/training",
  users: "/users",

  // Authenticated — admin
  adminAnnouncements: "/admin/announcements",
  adminFriends: "/admin/friends",
  adminOrganizations: "/admin/organizations",
  adminPunks: "/admin/punks",
  adminWatchlist: "/admin/watchlist",
  adminRegions: "/admin/regions",
  adminTasks: "/admin/tasks",
  adminTime: "/admin/time",
  adminPayments: "/admin/payments",

  // Public
  welcome: "/welcome",
  unauthorized: "/unauthorized",
  noOrg: "/no-org",
  wrongOrg: "/wrong-org",

  // Auth — handled by Auth0, no page.tsx
  authLogin: "/auth/login",
  authLogout: "/auth/logout",
} as const;

type Route = (typeof ROUTES)[keyof typeof ROUTES];

/** Routes handled by Auth0 — excluded from page.tsx existence checks. */
export const AUTH_ROUTES: readonly Route[] = [
  ROUTES.authLogin,
  ROUTES.authLogout,
];

/** Builders for dynamic routes. */
export const dynamicRoutes = {
  adminFriend: (id: string | number) => `/admin/friends/${id}`,
  adminPunk: (id: string | number) => `/admin/punks/${id}`,
  /** Watchlist page opened on a specific tab. */
  adminWatchlistTab: (tab: "friends" | "punks") =>
    `/admin/watchlist?tab=${tab}`,
  project: (id: string | number) => `/projects/${id}`,
  team: (id: string | number) => `/teams/${id}`,
  user: (id: string | number) => `/users/${id}`,
};
