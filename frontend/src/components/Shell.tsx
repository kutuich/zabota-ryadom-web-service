import type { NavGroup } from "../routes/navigation";
import { AppLayout } from "./AppLayout";

export function Shell({
  title,
  navigation,
  variant = "user",
  children
}: {
  title: string;
  navigation: NavGroup[];
  variant?: "admin" | "user";
  children: React.ReactNode;
}) {
  return <AppLayout title={title} navigation={navigation} variant={variant}>{children}</AppLayout>;
}
