import { Suspense, use, useMemo } from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";

export function HighlightedCode(props: {
  readonly className?: string | undefined;
  readonly code: string;
  readonly language: string;
}) {
  const { resolvedTheme } = useTheme();
  const themeName = resolveDiffThemeName(resolvedTheme);
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
