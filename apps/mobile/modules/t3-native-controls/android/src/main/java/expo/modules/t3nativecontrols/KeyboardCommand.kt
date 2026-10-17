package expo.modules.t3nativecontrols

import android.view.KeyEvent

internal fun keyboardCommandFor(event: KeyEvent): String? {
  if (event.action != KeyEvent.ACTION_DOWN || event.repeatCount != 0) {
    return null
  }
  return when {
    event.hasNoModifiers() -> when (event.keyCode) {
      KeyEvent.KEYCODE_DPAD_DOWN -> "paletteNext"
      KeyEvent.KEYCODE_DPAD_UP -> "palettePrevious"
      KeyEvent.KEYCODE_ESCAPE -> "paletteDismiss"
      else -> null
    }
    event.hasModifiers(KeyEvent.META_CTRL_ON) -> when (event.keyCode) {
      KeyEvent.KEYCODE_N -> "newTask"
      KeyEvent.KEYCODE_F -> "focusSearch"
      KeyEvent.KEYCODE_K -> "commandPalette"
      KeyEvent.KEYCODE_LEFT_BRACKET -> "back"
      KeyEvent.KEYCODE_BACKSLASH -> "toggleSidebar"
      in KeyEvent.KEYCODE_1..KeyEvent.KEYCODE_9 -> "thread.jump.${event.keyCode - KeyEvent.KEYCODE_0}"
      else -> null
    }
    event.hasModifiers(KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON) -> when (event.keyCode) {
      KeyEvent.KEYCODE_F -> "files"
      KeyEvent.KEYCODE_T -> "terminal"
      KeyEvent.KEYCODE_R -> "review"
      KeyEvent.KEYCODE_C -> "copyThreadReference"
      KeyEvent.KEYCODE_H -> "cycleHost"
      else -> null
    }
    else -> null
  }
}
