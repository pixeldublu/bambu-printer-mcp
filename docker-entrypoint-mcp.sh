#!/bin/bash
set -euo pipefail

mkdir -p /custom-services.d /custom-cont-init.d
cp /opt/01-install-mcp.sh /custom-cont-init.d/01-install-mcp.sh
chmod +x /custom-cont-init.d/01-install-mcp.sh

cat > /custom-services.d/bambu-mcp <<'SERVICE'
#!/bin/bash
set -euo pipefail
mkdir -p /config/.XDG
exec s6-envdir /var/run/s6/container_environment \
  s6-setuidgid abc \
  env \
  LD_LIBRARY_PATH=/opt/bambustudio/bin:/opt/bambustudio/lib:/opt/bambustudio/usr/lib \
  XDG_RUNTIME_DIR=/config/.XDG \
  WAYLAND_DISPLAY=wayland-1 \
  DISPLAY=:1 \
  node /opt/bambu-printer-mcp-src/dist/index.js
SERVICE
chmod +x /custom-services.d/bambu-mcp
exec /init

