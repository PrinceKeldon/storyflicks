"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

export default function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("storyflicks-theme");
      const initial: Theme = saved === "light" ? "light" : "dark";
      setTheme(initial);
      document.documentElement.dataset.theme = initial;
    } catch {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      window.localStorage.setItem("storyflicks-theme", next);
    } catch {
      // Theme still applies for this session when storage is unavailable.
    }
  }

  const isLight = theme === "light";
  return (
    <button
      className="theme-switch"
      type="button"
      onClick={toggleTheme}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      aria-pressed={isLight}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      <span className="theme-switch-icon" aria-hidden="true">{isLight ? "☾" : "☼"}</span>
      <span>{isLight ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}
