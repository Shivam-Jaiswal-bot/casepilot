"use client";

import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Error details are intentionally not rendered: they may contain internals. They are logged server-side.
  return (
    <div className="mx-auto max-w-xl pt-10">
      <Card>
        <EmptyState
          title="Something went wrong"
          description="An unexpected error occurred while loading this page. Your documents are safe."
          action={<Button onClick={reset}>Try again</Button>}
        />
      </Card>
    </div>
  );
}
