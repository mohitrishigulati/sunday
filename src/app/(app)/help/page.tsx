import { HelpGuide } from "@/components/help/help-guide";
import { PageHeader } from "@/components/ui/primitives";

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Help"
        description="Simple steps. Menu names English mein hain, explanation Hindi mein."
      />
      <HelpGuide />
    </div>
  );
}
