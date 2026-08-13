#!/bin/sh
# Copy the parent app's store versions onto the widget's built Info.plist.
# Invoked from the ExpoWidgetsTarget "Sync Widget Bundle Version" phase.
# Lives on disk so the pbxproj only stores a one-line bash call (inline
# multiline scripts with nested quotes break Nanaimo / pod install).

set -eu

DEST="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
if [ ! -f "$DEST" ]; then
  DEST="${BUILT_PRODUCTS_DIR}/${WRAPPER_NAME}/Info.plist"
fi
if [ ! -f "$DEST" ]; then
  echo "error: widget Info.plist not found for version sync" >&2
  exit 1
fi

APP_PLIST=""
for candidate in "${SRCROOT}"/*/Info.plist; do
  case "$candidate" in
    */ExpoWidgetsTarget/Info.plist) continue ;;
  esac
  if [ -f "$candidate" ]; then
    APP_PLIST="$candidate"
    break
  fi
done
if [ -z "$APP_PLIST" ] || [ ! -f "$APP_PLIST" ]; then
  echo "error: parent Info.plist not found under ${SRCROOT}" >&2
  exit 1
fi

for key in CFBundleVersion CFBundleShortVersionString; do
  value="$(/usr/libexec/PlistBuddy -c "Print :${key}" "$APP_PLIST")"
  if [ -z "$value" ]; then
    echo "error: $APP_PLIST is missing $key" >&2
    exit 1
  fi
  case "$value" in
  *[!0-9.]* | "")
    echo "error: $APP_PLIST $key is not a store version: $value" >&2
    exit 1
    ;;
  esac
  /usr/libexec/PlistBuddy -c "Set :${key} ${value}" "$DEST" \
    || /usr/libexec/PlistBuddy -c "Add :${key} string ${value}" "$DEST"
  echo "Synced widget ${key}=${value} from $APP_PLIST"
done
