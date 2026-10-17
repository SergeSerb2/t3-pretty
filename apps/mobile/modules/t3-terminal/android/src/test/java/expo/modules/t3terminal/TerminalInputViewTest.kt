package expo.modules.t3terminal

import android.text.InputType
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class TerminalInputViewTest {
  private val editor = TerminalInputView(RuntimeEnvironment.getApplication()).apply {
    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
  }
  private val keyEvents = mutableListOf<Pair<Int, Int>>()

  init {
    editor.setOnKeyListener { _, code, event ->
      keyEvents.add(event.action to code)
      true
    }
  }

  @Test
  fun softwareBackspaceReachesTheTerminalKeyListenerWithAnEmptyLocalBuffer() {
    val connection = requireNotNull(editor.onCreateInputConnection(EditorInfo()))
    assertTrue(connection.deleteSurroundingText(1, 0))
    assertEquals(
      listOf(KeyEvent.ACTION_DOWN to KeyEvent.KEYCODE_DEL, KeyEvent.ACTION_UP to KeyEvent.KEYCODE_DEL),
      keyEvents,
    )
    assertEquals("", editor.text.toString())
  }

  @Test
  fun codePointBackspaceReachesTheTerminalKeyListener() {
    val connection = requireNotNull(editor.onCreateInputConnection(EditorInfo()))
    assertTrue(connection.deleteSurroundingTextInCodePoints(1, 0))
    assertEquals(
      listOf(KeyEvent.ACTION_DOWN to KeyEvent.KEYCODE_DEL, KeyEvent.ACTION_UP to KeyEvent.KEYCODE_DEL),
      keyEvents,
    )
  }

  @Test
  fun localTextDeletionDoesNotAlsoDeleteRemoteText() {
    editor.setText("x")
    editor.setSelection(1)
    val connection = requireNotNull(editor.onCreateInputConnection(EditorInfo()))
    assertTrue(connection.deleteSurroundingText(1, 0))
    assertEquals("", editor.text.toString())
    assertTrue(keyEvents.isEmpty())
  }

  @Test
  fun disabledTerminalDoesNotForwardSoftwareBackspace() {
    val connection = requireNotNull(editor.onCreateInputConnection(EditorInfo()))
    editor.isEnabled = false
    connection.deleteSurroundingText(1, 0)
    connection.deleteSurroundingTextInCodePoints(1, 0)
    assertTrue(keyEvents.isEmpty())
  }
}
