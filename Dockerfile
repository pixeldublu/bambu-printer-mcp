FROM lscr.io/linuxserver/bambustudio:latest

USER root
COPY docker-entrypoint-mcp.sh /opt/docker-entrypoint-mcp.sh
COPY 01-install-mcp.sh /opt/01-install-mcp.sh
RUN chmod +x /opt/docker-entrypoint-mcp.sh /opt/01-install-mcp.sh
ENTRYPOINT ["/bin/bash", "/opt/docker-entrypoint-mcp.sh"]
