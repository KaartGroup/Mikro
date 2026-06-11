import { redirect } from "next/navigation";

export default function FriendsRedirect() {
  redirect("/admin/watchlist?tab=friends");
}
