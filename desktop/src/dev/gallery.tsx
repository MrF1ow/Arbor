import { renderMarkdown } from "~/domain/markdown";
import { useUiStore } from "~/stores/ui-store";

const COLOR_SWATCHES: { token: string; className: string }[] = [
  { token: "background", className: "bg-background" },
  { token: "foreground", className: "bg-foreground" },
  { token: "card", className: "bg-card" },
  { token: "popover", className: "bg-popover" },
  { token: "sidebar", className: "bg-sidebar" },
  { token: "muted", className: "bg-muted" },
  { token: "muted-foreground", className: "bg-muted-foreground" },
  { token: "faint-foreground", className: "bg-faint-foreground" },
  { token: "primary", className: "bg-primary" },
  { token: "primary-hover", className: "bg-primary-hover" },
  { token: "primary-foreground", className: "bg-primary-foreground" },
  { token: "accent", className: "bg-accent" },
  { token: "accent-foreground", className: "bg-accent-foreground" },
  { token: "selected", className: "bg-selected" },
  { token: "border", className: "bg-border" },
  { token: "input", className: "bg-input" },
  { token: "ring", className: "bg-ring" },
  { token: "success", className: "bg-success" },
  { token: "destructive", className: "bg-destructive" },
  { token: "destructive-surface", className: "bg-destructive-surface" },
  { token: "info", className: "bg-info" },
  { token: "backdrop", className: "bg-backdrop" },
];

const ALIAS_SWATCHES: { token: string; className: string }[] = [
  { token: "card-foreground", className: "bg-card-foreground" },
  { token: "popover-foreground", className: "bg-popover-foreground" },
  { token: "secondary", className: "bg-secondary" },
  { token: "secondary-foreground", className: "bg-secondary-foreground" },
  { token: "destructive-foreground", className: "bg-destructive-foreground" },
  { token: "sidebar-foreground", className: "bg-sidebar-foreground" },
  { token: "sidebar-primary", className: "bg-sidebar-primary" },
  { token: "sidebar-primary-foreground", className: "bg-sidebar-primary-foreground" },
  { token: "sidebar-accent", className: "bg-sidebar-accent" },
  { token: "sidebar-accent-foreground", className: "bg-sidebar-accent-foreground" },
  { token: "sidebar-border", className: "bg-sidebar-border" },
  { token: "sidebar-ring", className: "bg-sidebar-ring" },
];

const TYPE_SCALE: { name: string; className: string }[] = [
  { name: "2xs", className: "text-2xs" },
  { name: "xs", className: "text-xs" },
  { name: "sm", className: "text-sm" },
  { name: "base", className: "text-base" },
  { name: "lg", className: "text-lg" },
  { name: "xl", className: "text-xl" },
  { name: "2xl", className: "text-2xl" },
  { name: "3xl", className: "text-3xl" },
  { name: "title", className: "text-title" },
  { name: "read", className: "text-read" },
];

const RADIUS_SAMPLES: { name: string; className: string }[] = [
  { name: "xs", className: "rounded-xs" },
  { name: "sm", className: "rounded-sm" },
  { name: "md", className: "rounded-md" },
  { name: "lg", className: "rounded-lg" },
  { name: "xl", className: "rounded-xl" },
  { name: "full", className: "rounded-full" },
];

const SIZE_BARS = [
  { label: "sidebar", className: "w-sidebar h-row" },
  { label: "index", className: "w-index h-row" },
  { label: "header", className: "w-full h-header" },
  { label: "actionbar", className: "w-full h-actionbar" },
  { label: "row", className: "w-full h-row" },
  { label: "control", className: "w-control h-control" },
  { label: "control-lg", className: "w-control-lg h-control-lg" },
  { label: "reading", className: "w-full max-w-reading h-row" },
] as const;

const PROSE_SAMPLE = `<!-- arbor-pages:12-14 -->
# Sample digest

Intro paragraph with **bold** and a [digest link](./digests/week-1.md).

## Section

### Subsection detail

- First item
- Second item

| Topic | Status |
| --- | --- |
| Tokens | Ready |
| Theme | Ready |

Inline \`code\` span.
<!-- /arbor-pages:12-14 -->
`;

const GALLERY_FINGERPRINT = "arbor-dev-ui-token-gallery-6.0";

export default function DevGallery() {
  const appearance = useUiStore((state) => state.appearance);
  const setAppearance = useUiStore((state) => state.setAppearance);
  const prose = renderMarkdown(PROSE_SAMPLE);

  return (
    <div className="min-h-full bg-background p-6 text-foreground" data-dev-gallery={GALLERY_FINGERPRINT}>
      <header className="mb-8 flex flex-wrap items-center gap-4">
        <h1 className="font-serif text-title font-medium">Arbor UI tokens</h1>
        <div className="inline-flex gap-1 rounded-lg border border-border bg-muted p-1 transition-colors duration-panel ease-out-soft">
          {(["light", "dark", "system"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={appearance === mode}
              className={
                appearance === mode
                  ? "rounded-md bg-card px-3 py-1 text-xs capitalize text-foreground shadow-card transition-colors duration-fast ease-out-soft"
                  : "rounded-md px-3 py-1 text-xs capitalize text-muted-foreground transition-colors duration-fast ease-out-soft"
              }
              onClick={() => setAppearance(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold">Colors</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {COLOR_SWATCHES.map(({ token, className }) => (
            <li key={token} className="flex items-center gap-2 text-xs">
              <span className={`size-8 shrink-0 rounded-sm border border-border ${className}`} aria-hidden />
              <span className="font-mono text-muted-foreground">{token}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold">Shadcn alias tokens</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {ALIAS_SWATCHES.map(({ token, className }) => (
            <li key={token} className="flex items-center gap-2 text-xs">
              <span className={`size-8 shrink-0 rounded-sm border border-border ${className}`} aria-hidden />
              <span className="font-mono text-muted-foreground">{token}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold">Type scale</h2>
        <ul className="space-y-2">
          {TYPE_SCALE.map(({ name, className }) => (
            <li key={name} className={`flex items-baseline gap-3 ${className}`}>
              <span className="w-16 shrink-0 font-mono text-2xs text-faint-foreground">{name}</span>
              <span>The quick brown fox</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-2 text-sm">
          <p className="font-sans">Sans: system UI stack</p>
          <p className="font-serif">Serif: Iowan Old Style reading face</p>
          <p className="font-mono">Mono: log and code face</p>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold">Radius</h2>
        <div className="flex flex-wrap gap-4">
          {RADIUS_SAMPLES.map(({ name, className }) => (
            <div key={name} className="text-center text-2xs text-muted-foreground">
              <div className={`mb-1 size-12 border border-border bg-card ${className}`} />
              {name}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold">Layout sizes</h2>
        <ul className="space-y-2">
          {SIZE_BARS.map(({ label, className }) => (
            <li key={label} className="flex items-center gap-3 text-2xs text-muted-foreground">
              <span className="w-24 shrink-0 font-mono">{label}</span>
              <div className={`rounded-sm bg-primary/30 ${className}`} />
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold">Shadow</h2>
        <div className="w-48 rounded-md border border-border bg-card p-4 shadow-card">shadow-card</div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">prose-arbor</h2>
        {prose.pageChip ? (
          <span className="page-chip">Pages {prose.pageChip}</span>
        ) : null}
        <div className="prose-arbor" dangerouslySetInnerHTML={{ __html: prose.html }} />
      </section>
    </div>
  );
}
