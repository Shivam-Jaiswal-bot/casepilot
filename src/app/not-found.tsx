import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 pt-20">
      <Card>
        <EmptyState
          title="Not found"
          description="This page doesn't exist, or you don't have access to it."
          action={<ButtonLink href="/documents">Go to documents</ButtonLink>}
        />
      </Card>
    </div>
  );
}
