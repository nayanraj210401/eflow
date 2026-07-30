import * as React from "react";

const AvailableContentWidthContext = React.createContext<number | null>(null);

/**
 * Provides the live width of the app shell's content area — everything to
 * the right of the left thread sidebar (`Sidebar`/`SidebarProvider` in
 * `ui/sidebar.tsx`), measured via ResizeObserver on that flex sibling.
 * Unlike `window.innerWidth`, this reacts when the left sidebar opens,
 * closes, or resizes, since that only redistributes space inside a flex
 * row without changing the window's own dimensions.
 */
export function AvailableContentWidthProvider({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = React.useState<number | null>(null);
  const elementRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={elementRef} className="flex min-h-0 min-w-0 flex-1">
      <AvailableContentWidthContext value={width}>{children}</AvailableContentWidthContext>
    </div>
  );
}

export function useAvailableContentWidth(): number {
  const width = React.use(AvailableContentWidthContext);
  return width ?? (typeof window === "undefined" ? 1280 : window.innerWidth);
}
