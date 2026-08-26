import type { ToolCallDisplaySection } from "@t3tools/shared/shellCommandFormat";

import { HighlightedCode } from "./HighlightedCode";
import { MessageCopyButton } from "./MessageCopyButton";
import { cn } from "~/lib/utils";

const toolCallBlockClassName =
  "cursor-text whitespace-pre-wrap break-words font-mono text-secondary-label text-[length:var(--font-size-code,0.6875rem)] leading-relaxed select-text";

export function ToolCallExpandedBody(props: {
  readonly sections: ReadonlyArray<ToolCallDisplaySection>;
}) {
  return (
    <div className="mb-1 ms-7 mt-0.5 max-h-64 overflow-auto rounded-md border border-border/50 bg-foreground/[0.03] px-2.5 py-2 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none">
      <div className="flex flex-col gap-2">
        {props.sections.map((section, index) => (
          <ToolCallSectionBlock
            key={toolCallSectionKey(section)}
            section={section}
            showDivider={index > 0}
          />
        ))}
      </div>
    </div>
  );
}

function toolCallSectionKey(section: ToolCallDisplaySection): string {
  const body = section.kind === "command" ? section.original : section.text;
  return `${section.kind}:${body.length}:${body.slice(0, 96)}`;
}

function ToolCallSectionBlock(props: {
  readonly section: ToolCallDisplaySection;
  readonly showDivider: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {props.showDivider ? <div className="h-px bg-border/50" /> : null}
      {props.section.kind === "command" ? (
        <div className="flex items-start gap-1" data-testid="tool-call-command">
          <HighlightedCode
            className={cn(toolCallBlockClassName, "min-w-0 flex-1")}
            code={props.section.display}
            language="bash"
          />
          <MessageCopyButton
            className="mt-px shrink-0"
            label="Copy command"
            size="icon-xs"
            text={props.section.original}
            variant="ghost"
          />
        </div>
      ) : (
        <div data-testid={props.section.kind === "json" ? "tool-call-json" : "tool-call-output"}>
          {props.section.kind === "json" ? (
            <HighlightedCode
              className={toolCallBlockClassName}
              code={props.section.text}
              language="json"
            />
          ) : (
            <pre className={toolCallBlockClassName}>{props.section.text}</pre>
          )}
        </div>
      )}
    </div>
  );
}
