#!/bin/bash
set -euo pipefail
application=${1:?Pass the exported website app bundle.}
mode=${2:-configuration}
case "$mode" in configuration|public) ;; *) exit 2 ;; esac
source_dir=$(cd "$(dirname "$0")" && pwd)
frameworks=$(cd "$application/Contents/Frameworks" && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
contents="$stage/UpdateCheck.app/Contents"
mkdir -p "$contents/MacOS"
cp "$application/Contents/Info.plist" "$contents/Info.plist"
plutil -replace CFBundleIdentifier -string com.mcode.tests.updaterrelease "$contents/Info.plist"
plutil -replace CFBundleExecutable -string Check "$contents/Info.plist"
plutil -replace SUEnableAutomaticChecks -bool NO "$contents/Info.plist"
xcrun clang -fobjc-arc -framework AppKit -F "$frameworks" -framework Sparkle \
    -Xlinker -rpath -Xlinker "$frameworks" "$source_dir/macos-update.m" -o "$contents/MacOS/Check"
if [[ "$mode" == configuration ]]; then
    "$contents/MacOS/Check" configuration
else
    "$contents/MacOS/Check" current
    plutil -replace CFBundleVersion -string 0 "$contents/Info.plist"
    "$contents/MacOS/Check" older
fi
