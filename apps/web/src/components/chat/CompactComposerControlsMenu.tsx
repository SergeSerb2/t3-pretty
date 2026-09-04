import type { ProviderDriverKind, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode, useEffect } from "react";
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
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { composerFloatingLayerProps } from "./composerEventScope";
import { resolveRuntimeModeOption, runtimeModeOptionsForProvider } from "./runtimeModeOptions";
import { useComposerMenuState } from "./useComposerMenuState";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  provider: ProviderDriverKind;
  children: ReactNode;
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  traitsMenuContent?: ReactNode;
  size?: "sm" | "xs";
  autoCreatePullRequest: boolean;
  showAutoCreatePullRequestToggle: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * The resting strip keeps this menu mounted out of flow while every block
   * fits inline. Its portaled popup would outlive that transition, so an
   * open menu closes when its trigger hides.
   */
  hidden?: boolean;
  onToggleInteractionMode: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onToggleAutoCreatePullRequest: () => void;
}) {
  const size = props.size ?? "sm";
  const showAutoPrDot = props.showAutoCreatePullRequestToggle && props.autoCreatePullRequest;
  const [uncontrolledOpen, setUncontrolledOpen] = useComposerMenuState(props.hidden);
  const open = !props.hidden && (props.open ?? uncontrolledOpen);
  const setOpen = (nextOpen: boolean) => {
    setUncontrolledOpen(nextOpen);
    props.onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    if (props.hidden && (props.open ?? uncontrolledOpen)) {
      props.onOpenChange?.(false);
    }
  }, [props.hidden, props.open, props.onOpenChange, uncontrolledOpen]);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <ComposerControl
            size={size}
            variant="ghost"
            className={size === "xs" ? "relative shrink-0" : "relative shrink-0 px-2"}
            aria-label="More composer controls"
          />
        }
      >
        <ComposerControlIcon icon={EllipsisIcon} size={size} />
        {showAutoPrDot ? (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
          />
        ) : null}
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
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
