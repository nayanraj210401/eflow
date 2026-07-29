import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { RightSidebarBrowsingPanel } from "./RightSidebarBrowsingPanel";

describe("RightSidebarBrowsingPanel", () => {
  it("renders the Files | Diff switcher with both tabs non-closable", () => {
    const markup = renderToStaticMarkup(
      <RightSidebarBrowsingPanel
        environmentId={null}
        cwd={null}
        projectName={null}
        onOpenFile={() => undefined}
        diffAvailable={false}
        diffFiles={[]}
        diffSelectedFilePath={null}
        onSelectDiffFile={() => undefined}
      />,
    );

    expect(markup).toContain("Files");
    expect(markup).toContain("Diff");
    // Neither tab renders a close button — the switcher is non-closable.
    expect(markup).not.toContain('aria-label="Close Files"');
    expect(markup).not.toContain('aria-label="Close Diff"');
  });

  it("defaults to the Files tab, showing an empty state when no project is open", () => {
    const markup = renderToStaticMarkup(
      <RightSidebarBrowsingPanel
        environmentId={null}
        cwd={null}
        projectName={null}
        onOpenFile={() => undefined}
        diffAvailable
        diffFiles={[]}
        diffSelectedFilePath={null}
        onSelectDiffFile={() => undefined}
      />,
    );

    expect(markup).toContain("No project open.");
  });
});
