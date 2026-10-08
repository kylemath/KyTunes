#!/bin/bash
# Creates a macOS .app bundle for KyTunes
# Usage: ./scripts/create-app.sh [--install]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="KyTunes"
APP_DIR="$PROJECT_DIR/build/$APP_NAME.app"

echo "Building $APP_NAME.app..."

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# --- Info.plist ---
cat > "$APP_DIR/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>KyTunes</string>
    <key>CFBundleDisplayName</key>
    <string>KyTunes</string>
    <key>CFBundleIdentifier</key>
    <string>com.localplayer.app</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleExecutable</key>
    <string>LocalPlayer</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <false/>
</dict>
</plist>
PLIST

# --- Executable launcher ---
cat > "$APP_DIR/Contents/MacOS/LocalPlayer" << LAUNCHER
#!/bin/bash
PROJECT_DIR="$PROJECT_DIR"
exec "\$PROJECT_DIR/scripts/launch.sh"
LAUNCHER
chmod +x "$APP_DIR/Contents/MacOS/LocalPlayer"

# --- Icon ---
if [ -f "$PROJECT_DIR/build/AppIcon.icns" ]; then
  cp "$PROJECT_DIR/build/AppIcon.icns" "$APP_DIR/Contents/Resources/AppIcon.icns"
  echo "  Icon: ✓"
else
  echo "  Icon: ✗ (run icon generation first)"
fi

# Clear quarantine so Gatekeeper doesn't block on first launch
xattr -cr "$APP_DIR" 2>/dev/null || true

echo ""
echo "Created: $APP_DIR"

# Optionally copy to /Applications
if [ "$1" = "--install" ]; then
  echo "Installing to /Applications..."
  rm -rf "/Applications/$APP_NAME.app"
  cp -R "$APP_DIR" "/Applications/$APP_NAME.app"
  xattr -cr "/Applications/$APP_NAME.app" 2>/dev/null || true
  echo "Installed: /Applications/$APP_NAME.app"
  echo ""
  echo "You can now find 'KyTunes' in Spotlight or Launchpad."
fi

echo ""
echo "Done! You can:"
echo "  1. Double-click: build/$APP_NAME.app"
echo "  2. Install:      ./scripts/create-app.sh --install"
echo "  3. Drag to Dock: drag build/$APP_NAME.app to your Dock"
