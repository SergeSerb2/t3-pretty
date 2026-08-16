import { ProviderDriverKind, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { EllipsisIcon } from "lucide-react";
import {
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { ComposerControl } from "./ComposerControl";
import { resolveRuntimeModeOption, runtimeModeOptionsForProvider } from "./runtimeModeOptions";

/**
 * The composer footer's `⋯` menu. At full width it holds the per-thread knobs
 * that don't earn a chip of their own (skills, agents, auto-PR); at compact
 * width the traits, mode and access controls fold in as well. `children`
 * renders first and is expected to be the traits/skills/agents sections.
 */
export const ComposerOverflowMenu = memo(function ComposerOverflowMenu(props: {
  provider: ProviderDriverKind;
  children: ReactNode;
  interactionMode: ProviderInteractionMode;
  showInteractionModeToggle: boolean;
  onToggleInteractionMode: () => void;
  runtimeMode: RuntimeMode;
  showRuntimeModeSelect: boolean;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  autoCreatePullRequest: boolean;
  showAutoCreatePullRequestToggle: boolean;
  onToggleAutoCreatePullRequest: () => void;
}) {
  const showAutoPrDot = props.showAutoCreatePullRequestToggle && props.autoCreatePullRequest;
  return (
    <Menu>
      <MenuTrigger
        render={
          <ComposerControl className="relative shrink-0 px-2" aria-label="More composer controls" />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
        {showAutoPrDot ? (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
          />
        ) : null}
      </MenuTrigger>
      <MenuPopup align="start">
        {props.children}
        {props.showInteractionModeToggle ? (
          <>
            <MenuDivider />
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
            <MenuRadioGroup
              value={props.interactionMode}
              onValueChange={(value) => {
                if (!value || value === props.interactionMode) return;
                props.onToggleInteractionMode();
              }}
            >
              <MenuRadioItem value="default">Chat</MenuRadioItem>
              <MenuRadioItem value="plan">Plan</MenuRadioItem>
            </MenuRadioGroup>
          </>
        ) : null}
        {props.showRuntimeModeSelect ? (
          <>
            <MenuDivider />
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
            <MenuRadioGroup
              value={props.runtimeMode}
              onValueChange={(value) => {
                if (!value || value === props.runtimeMode) return;
                props.onRuntimeModeChange(value as RuntimeMode);
              }}
            >
              {runtimeModeOptionsForProvider(props.provider).map((mode) => (
                <MenuRadioItem key={mode} value={mode}>
                  {resolveRuntimeModeOption(props.provider, mode).label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </>
        ) : null}
        {props.showAutoCreatePullRequestToggle ? (
          <>
            <MenuDivider />
            <MenuCheckboxItem
              checked={props.autoCreatePullRequest}
              onCheckedChange={() => props.onToggleAutoCreatePullRequest()}
            >
              Create PR when done
            </MenuCheckboxItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
