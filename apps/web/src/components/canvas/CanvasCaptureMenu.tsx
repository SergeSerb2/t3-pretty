"use client";

/**
 * Toolbar "Capture" menu: the open preview browser tabs for this thread, plus
 * the window/screen picker. Rendered only on builds that expose a capture
 * bridge, so the web build never shows a dead control.
 */
import { AppWindow, Camera, Globe2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";

import type { CanvasCaptureApi } from "./useCanvasCapture";

export function CanvasCaptureMenu({ capture }: { capture: CanvasCaptureApi }) {
  if (!capture.supported) return null;
  const tabs = capture.tabs;
  const canCaptureTabs = capture.canCaptureTabs;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="ghost" size="xs" aria-label="Capture" className="gap-1.5">
            <Camera className="size-3.5" />
            Capture
          </Button>
        }
      />
      <MenuPopup side="bottom" align="end" className="w-60">
        {canCaptureTabs ? (
          <>
            <MenuGroupLabel>Browser tabs</MenuGroupLabel>
            {tabs.map((tab) => (
              <MenuItem key={tab.tabId} onClick={() => void capture.captureTab(tab)}>
                <Globe2 />
                <span className="truncate">{tab.title}</span>
              </MenuItem>
            ))}
            {capture.canCaptureWindows ? <MenuSeparator /> : null}
          </>
        ) : null}
        {capture.canCaptureWindows ? (
          <MenuItem onClick={capture.openWindowPicker}>
            <AppWindow />
            Window or screen…
          </MenuItem>
        ) : null}
        {!canCaptureTabs && !capture.canCaptureWindows ? (
          <MenuItem disabled>No capture sources available</MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
