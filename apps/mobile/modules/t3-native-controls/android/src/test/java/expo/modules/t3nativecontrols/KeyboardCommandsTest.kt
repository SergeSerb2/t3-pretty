package expo.modules.t3nativecontrols

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class KeyboardCommandsTest {
  private fun key(code: Int, modifiers: Int = KeyEvent.META_CTRL_ON) =
    KeyEvent(0, 0, KeyEvent.ACTION_DOWN, code, 0, modifiers)

  @Test
  fun controlShortcutsReachTheSameAppCommandsAsTheIosCommandKey() {
    for ((code, command) in listOf(
      KeyEvent.KEYCODE_N to "newTask",
      KeyEvent.KEYCODE_F to "focusSearch",
      KeyEvent.KEYCODE_K to "commandPalette",
      KeyEvent.KEYCODE_LEFT_BRACKET to "back",
      KeyEvent.KEYCODE_BACKSLASH to "toggleSidebar",
    )) {
      assertEquals(command, keyboardCommandFor(key(code)))
    }
    for (index in 1..9) {
      assertEquals("thread.jump.$index", keyboardCommandFor(key(KeyEvent.KEYCODE_0 + index)))
    }
  }

  @Test
  fun shiftedControlShortcutsOpenThreadPanesAndPreserveExistingCommands() {
    for ((code, command) in listOf(
      KeyEvent.KEYCODE_F to "files",
      KeyEvent.KEYCODE_T to "terminal",
      KeyEvent.KEYCODE_R to "review",
      KeyEvent.KEYCODE_C to "copyThreadReference",
      KeyEvent.KEYCODE_H to "cycleHost",
    )) {
      assertEquals(
        command,
        keyboardCommandFor(key(code, KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON)),
      )
    }
  }

  @Test
  fun physicalLeftAndRightControlUseGenericControlShortcuts() {
    for (side in listOf(KeyEvent.META_CTRL_LEFT_ON, KeyEvent.META_CTRL_RIGHT_ON)) {
      for (modifiers in listOf(side, side or KeyEvent.META_CTRL_ON)) {
        val event = key(KeyEvent.KEYCODE_K, modifiers)
        assertTrue(event.hasModifiers(KeyEvent.META_CTRL_ON))
        assertEquals("commandPalette", keyboardCommandFor(event))
        assertEquals("focusSearch", keyboardCommandFor(key(KeyEvent.KEYCODE_F, modifiers)))
      }
    }
  }

  @Test
  fun physicalControlAndShiftSidesUseShiftedControlShortcuts() {
    for (control in listOf(KeyEvent.META_CTRL_LEFT_ON, KeyEvent.META_CTRL_RIGHT_ON)) {
      for (shift in listOf(KeyEvent.META_SHIFT_LEFT_ON, KeyEvent.META_SHIFT_RIGHT_ON)) {
        for (modifiers in listOf(
          control or shift,
          control or shift or KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON,
        )) {
          val event = key(KeyEvent.KEYCODE_F, modifiers)
          assertTrue(event.hasModifiers(KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON))
          assertFalse(event.hasModifiers(KeyEvent.META_CTRL_ON))
          assertEquals("files", keyboardCommandFor(event))
          assertEquals("terminal", keyboardCommandFor(key(KeyEvent.KEYCODE_T, modifiers)))
        }
      }
    }
  }

  @Test
  fun physicalAltAndMetaSidesDoNotTriggerControlShortcuts() {
    for (control in listOf(KeyEvent.META_CTRL_LEFT_ON, KeyEvent.META_CTRL_RIGHT_ON)) {
      for (shift in listOf(0, KeyEvent.META_SHIFT_LEFT_ON, KeyEvent.META_SHIFT_RIGHT_ON)) {
        for (extra in listOf(
          KeyEvent.META_ALT_ON or KeyEvent.META_ALT_LEFT_ON,
          KeyEvent.META_ALT_ON or KeyEvent.META_ALT_RIGHT_ON,
          KeyEvent.META_META_ON or KeyEvent.META_META_LEFT_ON,
          KeyEvent.META_META_ON or KeyEvent.META_META_RIGHT_ON,
        )) {
          val modifiers = control or KeyEvent.META_CTRL_ON or extra or shift or
            (if (shift == 0) 0 else KeyEvent.META_SHIFT_ON)
          val event = key(KeyEvent.KEYCODE_F, modifiers)
          assertFalse(event.hasModifiers(KeyEvent.META_CTRL_ON))
          assertFalse(event.hasModifiers(KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON))
          assertNull(keyboardCommandFor(event))
        }
      }
    }
  }

  @Test
  fun paletteNavigationUsesUnmodifiedKeys() {
    assertEquals("paletteNext", keyboardCommandFor(key(KeyEvent.KEYCODE_DPAD_DOWN, 0)))
    assertEquals("palettePrevious", keyboardCommandFor(key(KeyEvent.KEYCODE_DPAD_UP, 0)))
    assertEquals("paletteDismiss", keyboardCommandFor(key(KeyEvent.KEYCODE_ESCAPE, 0)))
    assertNull(keyboardCommandFor(key(KeyEvent.KEYCODE_DPAD_DOWN)))
    assertNull(keyboardCommandFor(key(KeyEvent.KEYCODE_ESCAPE, KeyEvent.META_SHIFT_ON)))
  }

  @Test
  fun textEntryAndOtherModifierChordsDoNotTriggerAppCommands() {
    assertNull(keyboardCommandFor(key(KeyEvent.KEYCODE_N, 0)))
    assertNull(keyboardCommandFor(key(KeyEvent.KEYCODE_N, KeyEvent.META_CTRL_ON or KeyEvent.META_ALT_ON)))
    assertNull(keyboardCommandFor(key(KeyEvent.KEYCODE_H, KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON or KeyEvent.META_META_ON)))
    assertNull(keyboardCommandFor(KeyEvent(0, 0, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_K, 0, KeyEvent.META_CTRL_ON)))
    assertNull(keyboardCommandFor(KeyEvent(0, 0, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_K, 1, KeyEvent.META_CTRL_ON)))
  }
}
