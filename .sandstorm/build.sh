#!/bin/bash
set -euo pipefail
# This script is run in the VM each time you run `vagrant-spk dev`.  This is
# the ideal place to invoke anything which is normally part of your app's build
# process - transforming the code in your repository into the collection of files
# which can actually run the service in production
#
# Some examples:
#
#   * For a C/C++ application, calling
#       ./configure && make && make install
#   * For a Python application, creating a virtualenv and installing
#     app-specific package dependencies:
#       virtualenv /opt/app/env
#       /opt/app/env/bin/pip install -r /opt/app/requirements.txt
#   * Building static assets from .less or .sass, or bundle and minify JS
#   * Collecting various build artifacts or assets into a deployment-ready
#     directory structure

# By default, this script does nothing.  You'll have to modify it as
# appropriate for your application.
cd /opt/app

# Ensure unoserver tooling is present in dev builds even if VM wasn't reprovisioned.
if command -v sudo >/dev/null 2>&1; then
  if ! python3 -m pip --version >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y --no-install-suggests --no-install-recommends python3-pip
  fi
  if ! command -v unoconvert >/dev/null 2>&1 || ! command -v unoserver >/dev/null 2>&1; then
    sudo python3 -m pip install --break-system-packages unoserver
  fi
fi

# Build-time pre-baked LibreOffice profile packaged with the app.
# Prefer copying the setup-time profile (Davros pattern) to avoid hanging build.
rm -rf /opt/app/.sandstorm/libreoffice-profile
mkdir -p /opt/app/.sandstorm/libreoffice-profile
if [ -d /var/libreoffice/config ] && [ -r /var/libreoffice/config ]; then
  cp -a /var/libreoffice/config/. /opt/app/.sandstorm/libreoffice-profile/ || true
else
  # Fallback: bounded warmup if setup-time profile is unavailable.
  timeout 25s env JAVA_HOME= LO_JAVA_ENABLED=false soffice \
    -env:UserInstallation=file:///opt/app/.sandstorm/libreoffice-profile \
    --headless \
    --invisible \
    --nocrashreport \
    --nodefault \
    --nofirststartwizard \
    --nologo \
    --norestore \
    --terminate_after_init >/dev/null 2>&1 || true
fi

npm install

# bower install
