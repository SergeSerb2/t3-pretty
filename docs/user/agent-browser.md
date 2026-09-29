# Watching agents use the browser

Agents from every provider can drive the integrated browser: open pages,
click, type, scroll, and take screenshots. T3 Code makes that activity
visible so you always know what an agent is doing.

## The floating preview

When an agent starts interacting with a browser tab you can't currently see,
a floating preview pops up over the chat so you can watch. It is draggable
and resizable, and while the agent is in control it shows a blue glow ring.

- Close the floating preview and it stays closed — agent activity won't
  reopen it for that tab. Opening the browser panel or a new agent
  `preview_open` brings it back.
- Turn the behavior off entirely with the browser's "auto-show floating
  preview" setting.

## The agent cursor

A blue cursor shows where the agent is working. It glides to each target,
ripples on clicks, and labels what it's doing (Click, Type, Press, Scroll). When
you take over the tab yourself, the cursor fades until the agent acts again.

## Browser actions in chat

Browser tool calls appear in the timeline as plain sentences — "Clicked
“Send”", "Typed “hello”", "Opened localhost:5173" — with a pointer icon,
whatever provider ran them. Collapsed tool groups count them as browser
actions. Expand a row to see the raw call details.
