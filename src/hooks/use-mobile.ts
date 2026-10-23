import { useSyncExternalStore } from "react";

export const MOBILE_BREAKPOINT = 768;

const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") {
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
  }
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

// The server cannot know the viewport, so it renders the desktop layout and
// the client corrects it after hydration.
function getServerSnapshot() {
  return false;
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
