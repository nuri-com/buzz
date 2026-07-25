import { createFileRoute } from "@tanstack/react-router";
import { ChatPage } from "@/features/chat/ui/ChatPage";
import { NuriWalletGate } from "@/features/nuri-wallet/ui/NuriWalletGate";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <NuriWalletGate>
      <ChatPage />
    </NuriWalletGate>
  );
}
