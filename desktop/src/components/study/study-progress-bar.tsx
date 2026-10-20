export function StudyProgressBar({ ratio }: { ratio: number }) {
  return (
    <div className="flex h-progress min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full w-full origin-left bg-primary transition-transform duration-fast ease-out-soft"
        style={{ transform: `scaleX(${ratio})` }} // style-allow: live progress ratio
      />
    </div>
  );
}
