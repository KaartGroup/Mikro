import { redirect } from "next/navigation";

export default function PunksRedirect() {
  redirect("/admin/watchlist?tab=punks");
}
