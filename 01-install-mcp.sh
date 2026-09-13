#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if [ -f /opt/bambu-printer-mcp-src/.init-ok ]; then
  echo "**** Fork MCP already initialized ****"
  exit 0
fi

apt-get update
apt-get install -y --no-install-recommends nodejs git curl python3 ca-certificates
apt-get clean
rm -rf /var/lib/apt/lists/*

rm -rf /opt/bambu-printer-mcp-src
git clone https://github.com/pixeldublu/bambu-printer-mcp.git /opt/bambu-printer-mcp-src
cd /opt/bambu-printer-mcp-src
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm prune --omit=dev

test -s dist/index.js
test -s dist/printers/bambu.js
mkdir -p /Applications/BambuStudio.app/Contents/Resources/profiles
rm -rf /Applications/BambuStudio.app/Contents/Resources/profiles/BBL
ln -s /config/.config/BambuStudio/system/BBL /Applications/BambuStudio.app/Contents/Resources/profiles/BBL

touch /opt/bambu-printer-mcp-src/.init-ok
echo "**** Fork Bambu MCP initialization complete ****"
