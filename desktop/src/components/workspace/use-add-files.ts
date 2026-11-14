import { toast } from "sonner";

import { openDialog } from "~/lib/ipc";
import { useImportSourcesMutation } from "~/lib/queries/library";

/** "+ Add files": pick lecture files and import them into the class. */
export function useAddFiles(root: string | null, course: string) {
  const importSources = useImportSourcesMutation(root);

  const addFiles = async () => {
    if (!root) {
      return;
    }
    try {
      const picked = await openDialog({
        multiple: true,
        filters: [{ name: "Lecture files", extensions: ["pdf", "pptx", "docx"] }],
      });
      const paths = typeof picked === "string" ? [picked] : picked;
      if (!paths || paths.length === 0) {
        return;
      }
      await importSources.mutateAsync({ course, paths });
    } catch (error) {
      toast.error(String(error));
    }
  };

  return { addFiles, busy: importSources.isPending };
}
