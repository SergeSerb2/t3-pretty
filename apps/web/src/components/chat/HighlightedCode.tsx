import { Suspense, use, useMemo } from "react";

import { usePaintedAppearance } from "~/hooks/usePaintedAppearance";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { shouldHighlightCodeBlock } from "../composerCodeBlockHighlight";

export function HighlightedCode(props: {
  readonly className?: string | undefined;
  readonly code: string;
  readonly language: string;
}) {
  const resolvedTheme = usePaintedAppearance();
  const themeName = resolveDiffThemeName(resolvedTheme);
  // Tool output can be huge, and tokenizing it runs synchronously on the main
  // thread. Past the composer's measured cap it stays plain text.
  if (!shouldHighlightCodeBlock(props.code)) {
    return <pre className={props.className}>{props.code}</pre>;
  }
  return (
    <Suspense fallback={<pre className={props.className}>{props.code}</pre>}>
      <HighlightedCodeInner
        className={props.className}
        code={props.code}
        language={props.language}
        themeName={themeName}
      />
    </Suspense>
  );
}

function HighlightedCodeInner(props: {
  readonly className?: string | undefined;
  readonly code: string;
  readonly language: string;
  readonly themeName: ReturnType<typeof resolveDiffThemeName>;
}) {
  const highlighter = use(getSyntaxHighlighterPromise(props.language));
  const highlightedHtml = useMemo(() => {
    try {
      return highlighter.codeToHtml(props.code, {
        lang: props.language,
        theme: props.themeName,
      });
    } catch {
      return highlighter.codeToHtml(props.code, {
        lang: "text",
        theme: props.themeName,
      });
    }
  }, [highlighter, props.code, props.language, props.themeName]);

  return (
    <div
      className={cn("tool-call-shiki", props.className)}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
}
