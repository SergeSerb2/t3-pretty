import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import { describe, expect, it, vi } from "vite-plus/test";

import { areMemoizedReactMarkdownPropsEqual } from "./MemoizedReactMarkdown";

type MarkdownProps = ComponentProps<typeof ReactMarkdown>;

describe("MemoizedReactMarkdown", () => {
  it("skips parser renders while urgent updates retain the deferred text and stable options", () => {
    const parse = vi.fn();
    const components = {};
    const remarkPlugins: NonNullable<MarkdownProps["remarkPlugins"]> = [];
    const rehypePlugins: NonNullable<MarkdownProps["rehypePlugins"]> = [];
    const urlTransform = (url: string) => url;
    let previous: MarkdownProps | null = null;

    const reconcile = (props: MarkdownProps) => {
      if (previous === null || !areMemoizedReactMarkdownPropsEqual(previous, props)) {
        parse(props.children);
      }
      previous = props;
    };

    for (let index = 0; index < 100; index += 1) {
      reconcile({
        children: "deferred prefix",
        components,
        remarkPlugins,
        rehypePlugins,
        urlTransform,
      });
    }
    expect(parse).toHaveBeenCalledTimes(1);

    reconcile({
      children: "deferred prefix plus next delta",
      components,
      remarkPlugins,
      rehypePlugins,
      urlTransform,
    });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenLastCalledWith("deferred prefix plus next delta");
  });
});
