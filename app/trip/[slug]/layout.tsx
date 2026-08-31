import type { ReactNode } from "react";
import { ProfileMenu } from "@/components/ProfileMenu";

// Wraps every trip-scoped screen (Home, Discover, Battle, Catchup,
// Final, Leaderboard, Questions, Setări) so the profile menu is mounted
// once here instead of duplicated per page -- it renders nothing until
// this device has actually joined the trip (see ProfileMenu.tsx).
export default function TripLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { slug: string };
}) {
  return (
    <>
      <ProfileMenu slug={params.slug} />
      {children}
    </>
  );
}
