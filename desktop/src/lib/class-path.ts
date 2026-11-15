/** The class views a link can open. */
export type ClassTab = "overview" | "read" | "map" | "cards" | "quiz" | "ask";

/**
 * Search params every class route accepts: the ticked lectures, so Drill and Today links can set a
 * scope, and `root`, the library the class belongs to (two libraries can each have a class of the
 * same name, so the URL has to say which one it means).
 */
export type ClassSearch = { lectures?: string; root?: string };

export function classSearchFrom(search: Record<string, unknown>): ClassSearch {
  return {
    lectures: typeof search.lectures === "string" && search.lectures ? search.lectures : undefined,
    root: typeof search.root === "string" && search.root ? search.root : undefined,
  };
}

export type ClassLink =
  | { to: "/course/$course/overview"; params: { course: string } }
  | { to: "/course/$course/read/$digest"; params: { course: string; digest: string } }
  | { to: "/course/$course/map"; params: { course: string } }
  | { to: "/course/$course/practice/cards"; params: { course: string } }
  | { to: "/course/$course/practice/quiz"; params: { course: string } }
  | { to: "/course/$course/ask"; params: { course: string } };

/**
 * The typed route for a class tab: spread it into `navigate({...classPath(course, "cards")})`
 * or `<Link {...classPath(...)}>`. Every link into a class view goes through here so the old
 * paths can be dropped in one place (Q14). `read` needs the digest file name.
 */
export function classPath(course: string, tab: ClassTab, digest?: string): ClassLink {
  switch (tab) {
    case "overview":
      return { to: "/course/$course/overview", params: { course } };
    case "read":
      if (!digest) {
        throw new Error("classPath: the read tab needs a digest");
      }
      return { to: "/course/$course/read/$digest", params: { course, digest } };
    case "map":
      return { to: "/course/$course/map", params: { course } };
    case "cards":
      return { to: "/course/$course/practice/cards", params: { course } };
    case "quiz":
      return { to: "/course/$course/practice/quiz", params: { course } };
    case "ask":
      return { to: "/course/$course/ask", params: { course } };
  }
}

/** The concrete path for a class tab, for hrefs and assertions; `?root=` is appended when the library is given. */
export function classHref(course: string, tab: ClassTab, digest?: string, root?: string): string {
  const link = classPath(course, tab, digest);
  const path = link.to.replace(/\$(\w+)/g, (_, key: string) =>
    encodeURIComponent((link.params as Record<string, string>)[key]!),
  );
  return root ? `${path}?root=${encodeURIComponent(root)}` : path;
}

/** `?lectures=` carries course-prefixed digest paths, each URI-encoded and comma-joined. */
export function lecturesToSearch(digests: string[]): string | undefined {
  return digests.length > 0 ? digests.map(encodeURIComponent).join(",") : undefined;
}

export function lecturesFromSearch(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}
