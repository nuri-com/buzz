import { createFileRoute } from "@tanstack/react-router";
import { NuriWalletGate } from "@/features/nuri-wallet/ui/NuriWalletGate";
import { SpacesPage } from "@/features/spaces/ui/SpacesPage";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <NuriWalletGate>
      <SpacesPage />
    </NuriWalletGate>
  );
}
