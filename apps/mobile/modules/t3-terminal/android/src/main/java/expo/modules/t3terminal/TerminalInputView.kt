package expo.modules.t3terminal

import android.content.Context
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.widget.EditText

internal class TerminalInputView(context: Context) : EditText(context) {
  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
    val connection = super.onCreateInputConnection(outAttrs) ?: return null
    return object : InputConnectionWrapper(connection, false) {
      override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean =
        forwardBackspace(beforeLength, afterLength) ||
          super.deleteSurroundingText(beforeLength, afterLength)

      override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int): Boolean =
        forwardBackspace(beforeLength, afterLength) ||
          super.deleteSurroundingTextInCodePoints(beforeLength, afterLength)
    }
  }

  private fun forwardBackspace(beforeLength: Int, afterLength: Int): Boolean {
    // Terminal input is sent immediately and cleared locally. IMEs can delete
    // through InputConnection without emitting a hardware Backspace event.
    if (!isEnabled || beforeLength != 1 || afterLength != 0 || !text.isNullOrEmpty()) return false
    val handled = dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DEL))
    dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DEL))
    return handled
  }
}
