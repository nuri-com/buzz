import { createFileRoute } from "@tanstack/react-router";
import { NuriWalletGate } from "@/features/nuri-wallet/ui/NuriWalletGate";
import { ReposPage } from "@/features/repos/ui/ReposPage";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <NuriWalletGate>
      <ReposPage />
    </NuriWalletGate>
  );
}
