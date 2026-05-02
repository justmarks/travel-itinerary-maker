"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

type ThemeChoice = "light" | "dark" | "system";

const LABELS: Record<ThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * Theme submenu for use inside DropdownMenuContent. Renders a "Theme" item
 * that opens a nested Light / Dark / System radio group. Reused on desktop
 * and mobile so the affordance is identical in both shells.
 */
export function ThemeToggleMenu(): React.JSX.Element {
  // next-themes returns undefined for theme on the server. Wait for mount so
  // we don't render a misleading active state during hydration.
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const current = (mounted ? theme : undefined) as ThemeChoice | undefined;
  const Icon =
    current === "dark" ? Moon : current === "light" ? Sun : Monitor;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon className="mr-2 h-4 w-4" />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={current ?? "system"}
          onValueChange={(value) => setTheme(value as ThemeChoice)}
        >
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 h-4 w-4" />
            {LABELS.light}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 h-4 w-4" />
            {LABELS.dark}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="mr-2 h-4 w-4" />
            {LABELS.system}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * Compact icon-only toggle button that cycles light -> dark -> system. For
 * places where we want a single tap-target rather than a submenu — e.g.
 * pages without a user menu (login, public shared trip view).
 */
export function ThemeToggleButton(props: {
  className?: string;
}): React.JSX.Element | null {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const current = (theme ?? "system") as ThemeChoice;
  const next: ThemeChoice =
    current === "light" ? "dark" : current === "dark" ? "system" : "light";
  const Icon = current === "dark" ? Moon : current === "light" ? Sun : Monitor;

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${LABELS[next]} theme`}
      title={`Theme: ${LABELS[current]}`}
      className={
        props.className ??
        "flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
      }
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
