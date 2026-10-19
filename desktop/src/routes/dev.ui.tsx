import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, type ComponentType } from "react";

const DevGallery: ComponentType | null = import.meta.env.DEV
  ? lazy(() => import("~/dev/gallery"))
  : null;

export const Route = createFileRoute("/dev/ui")({
  component: DevUiPage,
});

function DevUiPage() {
  if (!import.meta.env.DEV || DevGallery === null) {
    return <p>Not available in production builds.</p>;
  }

  const Gallery = DevGallery;
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading token gallery…</p>}>
      <Gallery />
    </Suspense>
  );
}
