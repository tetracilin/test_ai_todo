import { NavLink } from "@/lib/router";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/story-map", label: "Story map", end: true },
  { to: "/story-map/backlog", label: "Product backlog", end: false },
];

/** Switches between the two views of the same story map data. */
export function StoryMapTabs() {
  return (
    <nav aria-label="Story map views" className="flex gap-1 border-b border-border">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              "px-3 py-1.5 text-sm",
              isActive ? "border-b-2 border-foreground font-medium" : "text-muted-foreground hover:text-foreground",
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
