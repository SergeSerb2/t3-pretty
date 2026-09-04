# Agent computer control

T3 Code can give agents running on a macOS environment native screen, mouse,
keyboard, and scrolling tools. Turn on **Settings → Integrations → Computer
control → Agent computer control**. New agent sessions then receive the tools;
existing sessions keep the tools they started with.

The server Mac must grant the T3 desktop app Screen Recording permission for
screenshots and Accessibility permission for mouse and keyboard actions. The
tools remain unavailable on non-macOS server environments.

All mouse, scroll, and screenshot-region inputs use the Quartz coordinates
returned by the screen-information tool, with the origin at the top-left of the
main display. Do not multiply them by the backing scale factor. Returned
screenshot images are normalized so one pixel equals one Quartz coordinate
unit. Their files are temporary and expire after ten minutes.
