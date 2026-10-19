import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <main>
      <h1>Arbor 6.0 rebuild in progress</h1>
      <p>
        The legacy UI is available at <code>/legacy.html</code> in dev.
      </p>
    </main>
  );
}
