#!/bin/bash

# When you change this file, you must take manual action. Read this doc:
# - https://docs.sandstorm.io/en/latest/vagrant-spk/customizing/#setupsh

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
NODE_MAJOR=24
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
apt-get update

apt-get install -y --no-install-suggests --no-install-recommends \
  nodejs \
  capnproto \
  git-core \
  g++ \
  python3-pip \
  python3-uno \
  fontconfig \
  libreoffice-writer

# unoconv is deprecated in favor of unoserver + unoconvert.
if ! python3 -m pip --version >/dev/null 2>&1; then
  apt-get install -y --no-install-suggests --no-install-recommends python3-pip
fi
python3 -m pip install --break-system-packages --upgrade pip
python3 -m pip install --break-system-packages unoserver

# Remove Java integration and aggressively trim optional LO assets.
apt-get purge -y libreoffice-java-common || true

echo "Removing unused components"
rm -rf /usr/lib/libreoffice/share/gallery || true
rm -rf /usr/share/help || true
rm -rf /usr/share/hunspell /usr/share/hyphen /usr/share/mythes || true
find /usr/share/libreoffice -maxdepth 2 -type d -name "dict-*" -prune -exec rm -rf {} + 2>/dev/null || true
find /usr/share/libreoffice -maxdepth 2 -type d -name "autotext" -prune -exec rm -rf {} + 2>/dev/null || true
find /usr/share/locale -mindepth 1 -maxdepth 1 ! -name "en" ! -name "en_US" -prune -exec rm -rf {} + 2>/dev/null || true

echo "Regenerating fontconfig cache"
# Pre-generate fontconfig cache in the image.
fc-cache -f || true

# Pre-bake a fully initialized LO user profile into the image.
rm -rf /opt/libreoffice-profile
mkdir -p /opt/libreoffice-profile
echo "Starting soffice to pre-warm profile"
JAVA_HOME= LO_JAVA_ENABLED=false /usr/bin/soffice \
  -env:UserInstallation=file:///opt/libreoffice-profile \
  --headless \
  --invisible \
  --nocrashreport \
  --nodefault \
  --nofirststartwizard \
  --nologo \
  --norestore || true

exit 0
