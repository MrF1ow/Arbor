import { useStudyModelLabel } from "~/components/study/use-study-model-label";
import { Button } from "~/components/ui/button";

/**
 * "No flashcards yet" / "No quiz yet": the dashed card with Generate, shown when the class, or the
 * ticked lectures, have no deck. `modelHint` ("Select a model in Settings.") replaces the
 * "Uses Codex · gpt-5.5" line when no model is set.
 */
export function StudyEmpty({
  title,
  description,
  modelHint,
  disabled,
  disabledReason,
  onGenerate,
}: {
  title: string;
  description: string;
  modelHint: string | null;
  disabled: boolean;
  disabledReason?: string;
  onGenerate: () => void;
}) {
  const modelLabel = useStudyModelLabel();
  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card px-8 py-10 text-center">
      <h2 className="font-serif text-title text-foreground">{title}</h2>
      <p className="text-small text-muted-foreground">{description}</p>
      {modelHint ? (
        <p className="text-small text-muted-foreground">{modelHint}</p>
      ) : modelLabel ? (
        <p className="text-caption text-faint-foreground">Uses {modelLabel}</p>
      ) : null}
      <Button disabled={disabled} title={disabledReason} onClick={onGenerate} className="mt-1">
        Generate
      </Button>
    </div>
  );
}
