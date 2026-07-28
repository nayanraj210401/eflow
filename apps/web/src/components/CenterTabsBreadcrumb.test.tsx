import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CenterTabsBreadcrumb } from "./CenterTabsBreadcrumb";

describe("CenterTabsBreadcrumb", () => {
  it("renders project name and thread name separated by a static separator", () => {
    const markup = renderToStaticMarkup(
      <CenterTabsBreadcrumb projectName="eflow" threadName="vscode-style-tab-layout-redesign" />,
    );

    expect(markup).toContain("eflow");
    expect(markup).toContain("vscode-style-tab-layout-redesign");
    expect(markup).toContain("/");
    expect(markup).toContain("data-center-tabs-breadcrumb");
  });

  it("renders only the project name when no thread is active", () => {
    const markup = renderToStaticMarkup(
      <CenterTabsBreadcrumb projectName="eflow" threadName={null} />,
    );

    expect(markup).toContain("eflow");
    expect(markup).not.toContain("data-thread-name");
  });

  it("renders nothing when neither project nor thread name is resolved yet", () => {
    const markup = renderToStaticMarkup(
      <CenterTabsBreadcrumb projectName={null} threadName={null} />,
    );

    expect(markup).toBe("");
  });

  it("is a static breadcrumb with no dropdown/menu controls", () => {
    const markup = renderToStaticMarkup(
      <CenterTabsBreadcrumb projectName="eflow" threadName="main" />,
    );

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain('role="menu"');
  });
});
