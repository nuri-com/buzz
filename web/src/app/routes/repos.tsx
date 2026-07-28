import { createFileRoute } from "@tanstack/react-router";
import { NuriWalletGate } from "@/features/nuri-wallet/ui/NuriWalletGate";
import { ReposPage } from "@/features/repos/ui/ReposPage";

export const Route = createFileRoute("/repos")({
  component: ReposRoute,
});

function ReposRoute() {
  return (
    <NuriWalletGate>
      <ReposPage />
    </NuriWalletGate>
  );
}
