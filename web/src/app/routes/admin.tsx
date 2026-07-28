import { createFileRoute } from "@tanstack/react-router";
import { AdminPage } from "@/features/admin/ui/AdminPage";
import { NuriWalletGate } from "@/features/nuri-wallet/ui/NuriWalletGate";

export const Route = createFileRoute("/admin")({
  component: AdminRoute,
});

function AdminRoute() {
  return (
    <NuriWalletGate>
      <AdminPage />
    </NuriWalletGate>
  );
}
