#!/bin/bash
# Default values
app="paid"
mode="d"
fdroidFlag=""
packageType="apk"  # New default: apk or aar
webpackmode="development"
cordovamode=""
# Acode Developer Edition: optional, off by default (see "jsoptimize" case
# below) - lets a "dev" (debug-signed, no secrets required) build still get
# the "prod" webpack/babel optimization pass (minified JS bundle). Debug
# builds normally skip this, which is part of why the app's own loading
# screen can feel noticeably slower on a debug APK than on a Play Store
# build - a much bigger, unminified JS bundle for the WebView to parse and
# run on startup. Does NOT touch cordovamode, so the package stays debug
# (installable without a keystore secret) - only the JS output changes.
jsOptimizeFlag=""

# Check all arguments for specific values
for arg in "$@"; do
    case "$arg" in
        "free"|"paid")
            app="$arg"
            ;;
        "p"|"prod"|"d"|"dev")
            mode="$arg"
            ;;
        "fdroid")
            fdroidFlag="fdroid"
            ;;
        "apk"|"bundle")
            packageType="$arg"
            ;;
        "jsoptimize")
            jsOptimizeFlag="true"
            ;;
        *)
            echo "Warning: Unknown argument '$arg' ignored"
            ;;
    esac
done

root=$(npm prefix)

if [ -n "$TMPDIR" ] && [ -r "$TMPDIR" ] && [ -w "$TMPDIR" ]; then
  tmpdir="$TMPDIR"
elif [ -r "/tmp" ] && [ -w "/tmp" ]; then
  tmpdir="/tmp"
else
  echo "Warning: No usable temporary directory found (TMPDIR or /tmp not accessible). Skipping fdroid.bool file." >&2
  tmpdir=""
fi

if [ "$fdroidFlag" = "fdroid" ]; then
  if [ -n "$tmpdir" ]; then
    echo "true" > "$tmpdir/fdroid.bool"
  fi

  # Remove only if installed
  if [ -d "plugins/com.foxdebug.acode.rk.exec.proot" ]; then
    cordova plugin remove com.foxdebug.acode.rk.exec.proot
  fi

  if [ -d "plugins/cordova-plugin-iap" ]; then
    cordova plugin remove cordova-plugin-iap
  fi
else
  if [ -n "$tmpdir" ]; then
    echo "false" > "$tmpdir/fdroid.bool"
  fi

  # Add only if the src exists and not already installed
  if [ -d "src/plugins/proot" ] && [ ! -d "plugins/com.foxdebug.acode.rk.exec.proot" ]; then
    cordova plugin add src/plugins/proot/
  fi

  if [ -d "src/plugins/iap" ] && [ ! -d "plugins/cordova-plugin-iap" ]; then
    cordova plugin add src/plugins/iap/
  fi
fi



# Normalize mode values
if [ "$mode" = "p" ] || [ "$mode" = "prod" ]
then
mode="p"
webpackmode="production"
cordovamode="--release"
fi

# configMode drives only utils/config.js (which just toggles .babelrc's
# "compact" minification flag - see utils/config.js). jsOptimizeFlag upgrades
# it to "p" without touching cordovamode above, so the Cordova package stays
# whatever $mode already selected (debug, no signing secret needed).
configMode="$mode"
if [ "$jsOptimizeFlag" = "true" ] && [ "$mode" != "p" ]; then
    webpackmode="production"
    configMode="p"
fi

# Set build target based on packageType
if [ "$packageType" = "bundle" ]; then
    echo "Building AAR library file..."
else
    echo "Building APK file..."
fi

RED=''
NC=''

script1="node ./utils/config.js $configMode $app"
script2="rspack --mode $webpackmode"
# script3="node ./utils/loadStyles.js"

echo "type : $packageType"

script4="cordova build android $cordovamode -- --packageType=$packageType"

eval "
echo \"${RED}$script1${NC}\";
$script1;
echo \"${RED}$script2${NC}\";
$script2&&
# echo \"${RED}$script3${NC}\";
# $script3;
echo \"${RED}$script4${NC}\";
$script4;
"
