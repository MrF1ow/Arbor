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
      {import.meta.env.DEV ? (
        <p>
          <a href="#/dev/ui" className="text-primary underline-offset-2 hover:underline">
            Open the dev UI token gallery
          </a>
        </p>
      ) : null}
    </main>
  );
}
