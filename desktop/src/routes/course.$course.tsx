import {
  createFileRoute,
  Link,
  retainSearchParams,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "~/components/app/empty-state";
import { ClassWorkspace } from "~/components/workspace/class-workspace";
import { courseDisplayName } from "~/domain/course";
import type { Settings } from "~/domain/types";
import { classSearchFrom } from "~/lib/class-path";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { canUseDesktopIpc } from "~/domain/tauri";
import {
  usePendingActiveRootSwitch,
  useSwitchActiveRootMutation,
  whenNoActiveRootSwitchPending,
} from "~/lib/queries/active-root";
import { qk } from "~/lib/queries/keys";
import { fetchCourses, useCourses } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import { useUiStore } from "~/stores/ui-store";

/**
 * Two libraries can each have a class of the same name, so a class URL names its library:
 * `?root=<library path>`. Every route under a class keeps it (`retainSearchParams`), a link from
 * outside a class sets it, and arriving at a URL whose library is not the active one (browser
 * Back or Forward) switches to that library before the class renders.
 */
export const Route = createFileRoute("/course/$course")({
  validateSearch: (search: Record<string, unknown>): { root?: string } => ({ root: classSearchFrom(search).root }),
  search: { middlewares: [retainSearchParams(["root"])] },
  component: CourseLayout,
});

/**
 * The library the URL names, when it is a configured library: switch to it once per location (the
 * router's history key) unless it is already the active library with no switch queued or running,
 * and report `true` until the active library is it, and for as long as any library switch is
 * queued or running, so the class page never renders, and so never saves anything, for a library
 * the URL does not name.
 *
 * A location queues a switch of its own whenever any switch is pending, even one heading to the
 * very library its URL names: that switch can still fail (the save after its cache flip), and only
 * a location's own switch comes back to the location on failure to rewrite its URL. Back followed
 * by a quick Forward is the case: the Forward's library is the Back's pending target and, once the
 * Back's save has flipped the cache, the "active" one. A redundant switch costs a settings read: a
 * switch to the library already active does nothing.
 *
 * Key, pathname and `root` are all read from the router's current location, which is already the
 * next one while a navigation is pending (`Route.useSearch()` is still the old match's). The
 * decision acts only on a location under a class route, so leaving for Today never switches. It
 * never fires because the active library changed under a page that stays mounted (the sidebar's
 * library header switches, then leaves for Today). A `?root=` naming a library that is no longer
 * configured is ignored.
 */
function useSwitchToUrlRoot(activeRoot: string | null, settings: ReturnType<typeof useSettings>["data"]) {
  const { mutateAsync: switchRoot } = useSwitchActiveRootMutation();
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const pendingRoot = usePendingActiveRootSwitch();
  const locationKey = useRouterState({
    select: (s) => String(s.location.state.__TSR_key ?? s.location.state.key ?? s.location.href),
  });
  const underClass = useRouterState({ select: (s) => s.location.pathname.startsWith("/course/") });
  const locationRoot = useRouterState({ select: (s) => classSearchFrom(s.location.search).root });
  const urlRoot = underClass ? locationRoot : undefined;

  const [seenKey, setSeenKey] = useState<string | null>(null);
  const [switchTo, setSwitchTo] = useState<{ key: string; root: string } | null>(null);
  // The target for this render: a new location decides it right now, so the rest of the render
  // (and the home library it records) already sees it instead of waiting for the state to land.
  let target = switchTo;
  if (settings && seenKey !== locationKey) {
    const configured = settings.knowledge_roots?.some((entry) => entry.path === urlRoot) ?? false;
    // Queue a switch of this location's own whenever any switch is pending or the URL's library is
    // not the active one. A switch already heading to the URL's library (another location's, or the
    // sidebar's) can still fail, even after the optimistic cache flip made the library look active,
    // and only a location's own switch comes back to it on failure. A redundant one costs a settings
    // read: a switch to the library already active does nothing.
    const differs = pendingRoot !== null || urlRoot !== activeRoot;
    target = urlRoot && configured && differs ? { key: locationKey, root: urlRoot } : null;
    setSeenKey(locationKey);
    setSwitchTo(target);
  }
  // Reached only once nothing is queued: the active library flips as soon as a switch starts
  // saving, while a later queued switch may still move it elsewhere.
  if (target !== null && pendingRoot === null && activeRoot === target.root) {
    target = null;
    setSwitchTo(null);
  }
  // Never render a class for one library under a URL naming another configured one, whatever led
  // there: a mismatch with nothing pending is a page about to be left (the sidebar's library header)
  // or rewritten (a failed switch, the other-libraries lookup).
  const urlConfigured = settings?.knowledge_roots?.some((entry) => entry.path === urlRoot) ?? false;
  const mismatch = urlRoot !== undefined && urlConfigured && activeRoot !== null && urlRoot !== activeRoot;
  const switching =
    (urlRoot !== undefined && !settings) || target !== null || pendingRoot !== null || mismatch;

  const targetKey = target?.key ?? null;
  const targetRoot = target?.root ?? null;
  const startedSwitch = useRef<string | null>(null);
  useEffect(() => {
    if (targetKey === null || targetRoot === null) {
      startedSwitch.current = null;
      return;
    }
    if (startedSwitch.current === targetKey) {
      return;
    }
    startedSwitch.current = targetKey;
    switchRoot(targetRoot).catch((error: unknown) => {
      // Fall back to the active library. Only this location's own target: a newer location may
      // have a switch of its own queued.
      setSwitchTo((current) => (current?.key === targetKey ? null : current));
      toast.error(String(error));
      // The class must not render one library under a URL that names another: once every switch has
      // landed (one queued behind this failure, e.g. the sidebar's library header, decides where the
      // app ends up), make the URL name the library that is really active. Only while the router is
      // still on this location.
      void whenNoActiveRootSwitchPending().then(() => {
        const nowActive = pickActiveRoot(queryClient.getQueryData<Settings>(qk.settings()));
        const { location } = router.state;
        const stillHere = String(location.state.__TSR_key ?? location.state.key ?? location.href) === targetKey;
        if (stillHere && nowActive && nowActive !== targetRoot) {
          void navigate({
            to: ".",
            search: (prev: Record<string, unknown>) => ({ ...prev, root: nowActive }),
            replace: true,
          });
        }
      });
    });
  }, [targetKey, targetRoot, switchRoot, queryClient, router, navigate]);

  return switching;
}

function CourseLayout() {
  const { course } = Route.useParams();
  const { root: urlRoot } = Route.useSearch();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const courses = useCourses(activeRoot);
  const setLastCourse = useUiStore((s) => s.setLastCourse);
  const { mutateAsync: switchRoot } = useSwitchActiveRootMutation();
  // The class does not render, and so cannot save anything, until the active library is the URL's.
  const switchingToUrlRoot = useSwitchToUrlRoot(activeRoot, settings.data);

  useEffect(() => {
    if (!activeRoot || !course || switchingToUrlRoot) {
      return;
    }
    const list = courses.data;
    if (list == null) {
      return;
    }
    if (list.includes(course)) {
      setLastCourse({ root: activeRoot, course });
    }
  }, [activeRoot, course, courses.data, setLastCourse, switchingToUrlRoot]);

  const exists = (courses.data ?? []).includes(course);
  const missing = courses.isSuccess && !exists && !switchingToUrlRoot;
  // A list that is being refetched may just lack a class that was created a moment ago ("+ Add
  // class" navigates before the refetch lands): look in the other libraries, and switch to one,
  // only once the active library's own list is fresh and still lacks the class.
  const fresh = !courses.isFetching;

  // Class routes only look in the active library, but a link (browser Back after Today, Search,
  // Start review or Drill switched library) can name a class of another configured one: find it
  // there and switch to it, as `useOpenClass` does, instead of reporting it missing.
  const otherRoots = (settings.data?.knowledge_roots ?? [])
    .map((entry) => entry.path)
    .filter((path) => path !== activeRoot);
  const lookups = useQueries({
    queries: otherRoots.map((root) => ({
      queryKey: qk.courses(root),
      queryFn: () => fetchCourses(root),
      enabled: missing && fresh && canUseDesktopIpc(),
    })),
  });
  // The library this class page was opened in. When something else switches library while the page
  // is still mounted (the sidebar's library header, or a cross-library link that switches before it
  // navigates), the page is about to be left: never switch back to the class's own library then.
  // The same class name in another library (Back across two libraries) is another class page.
  const homeKey = `${course}\n${urlRoot ?? ""}`;
  const [home, setHome] = useState<{ key: string; root: string } | null>(null);
  if (activeRoot && !switchingToUrlRoot && home?.key !== homeKey) {
    setHome({ key: homeKey, root: activeRoot });
  }
  const switchedAway = activeRoot != null && home != null && home.key === homeKey && home.root !== activeRoot;
  const foundRoot =
    missing && fresh && !switchedAway ? otherRoots.find((_, i) => lookups[i]?.data?.includes(course)) : undefined;
  const searching = missing && (!fresh || (foundRoot === undefined && lookups.some((q) => q.isPending)));
  const switching = useRef<string | null>(null);
  const router = useRouter();
  const navigate = useNavigate();
  useEffect(() => {
    // Once per class page and library found, whether it lands or fails, as before class URLs named
    // their library: a pending switch hides `foundRoot` for a moment (the page counts as switching),
    // and a failed switch must not be retried every time it comes back.
    if (!foundRoot) {
      return;
    }
    const attempt = `${homeKey}\n${foundRoot}`;
    if (switching.current === attempt) {
      return;
    }
    switching.current = attempt;
    switchRoot(foundRoot)
      .then(() => {
        setHome({ key: homeKey, root: foundRoot });
        // The URL has to name the library that has the class. A stale `?root=` (a library that
        // lacks the class) would make every later navigation inside the class, which keeps it,
        // switch back to that library and find the class missing there. Only while the page is still
        // this class with that same root (the switch takes time), and only when the URL names one: a
        // URL with no `?root=` is left as it is. The replacement is a new location whose root is the
        // active library, so the switch hook has nothing to do for it.
        const { location, matches } = router.state;
        const stillHere = matches.some((m) => m.routeId === Route.id && m.params.course === course);
        if (stillHere && urlRoot !== undefined && classSearchFrom(location.search).root === urlRoot && urlRoot !== foundRoot) {
          void navigate({
            to: ".",
            search: (prev: Record<string, unknown>) => ({ ...prev, root: foundRoot }),
            replace: true,
          });
        }
      })
      .catch((error: unknown) => {
        toast.error(String(error));
      });
  }, [course, homeKey, urlRoot, foundRoot, switchRoot, router, navigate]);

  if (switchingToUrlRoot) {
    // Switching to the library this URL names: nothing renders against the old one meanwhile.
    return <div className="flex min-h-0 flex-1" />;
  }

  if (missing && (foundRoot !== undefined || searching || switchedAway)) {
    // Looking in the other libraries, or switching to the one that has it.
    return <div className="flex min-h-0 flex-1" />;
  }

  if (missing) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          icon={BookOpen}
          title="Class not found"
          description={`${courseDisplayName(course)} is not in any of your libraries.`}
          actions={
            <Link to="/" className="text-sm text-primary underline-offset-2 hover:underline">
              Back to Today
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ClassWorkspace course={course} />
    </div>
  );
}
