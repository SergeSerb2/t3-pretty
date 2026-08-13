import { memo, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";

export type MemoizedReactMarkdownProps = ComponentProps<typeof ReactMarkdown>;

/** React's default memo comparison, made explicit so parser bailouts stay testable. */
export function areMemoizedReactMarkdownPropsEqual(
  previous: Readonly<MemoizedReactMarkdownProps>,
  next: Readonly<MemoizedReactMarkdownProps>,
): boolean {
  const previousKeys = Object.keys(previous) as Array<keyof MemoizedReactMarkdownProps>;
  const nextKeys = Object.keys(next);
  return (
    previousKeys.length === nextKeys.length &&
    previousKeys.every((key) => Object.is(previous[key], next[key]))
  );
}

// ReactMarkdown synchronously parses its children. The explicit boundary lets
// ChatMarkdown rerender urgently while a stable deferred text value skips that
// parser subtree altogether.
export const MemoizedReactMarkdown = memo(ReactMarkdown, areMemoizedReactMarkdownPropsEqual);
