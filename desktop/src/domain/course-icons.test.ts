import { BookOpen } from "lucide-react";
import { describe, expect, it } from "vitest";

import { courseColorClass, courseIconKey } from "~/domain/course-icons";
import { COURSE_ICONS, courseIconFor } from "~/domain/course-icons-catalog";

describe("course icons domain", () => {
  it("every key is unique and has an Icon", () => {
    const keys = COURSE_ICONS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of COURSE_ICONS) {
      expect(entry.Icon).toBeTruthy();
    }
  });

  it("unknown keys fall back", () => {
    const meta = { bio: { icon: "not-a-real-icon", color: "not-a-color" } };
    expect(courseIconKey(meta, "bio")).toBe("book-open");
    expect(courseIconFor(meta, "bio")).toBe(BookOpen);
    expect(courseColorClass(meta, "bio")).toBe("");
    expect(courseColorClass({ bio: { color: "olive" } }, "bio")).toBe("text-course-olive");
  });
});
