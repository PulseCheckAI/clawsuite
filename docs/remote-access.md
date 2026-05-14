# Remote & Mobile Access Guide

Access ControlSuite from mobile devices, remote machines, or across your network.

## Option 1: Tailscale (Recommended)

Tailscale creates a private mesh VPN — no port forwarding, no firewall config.

### Setup

1. Install Tailscale on both your server and mobile device: https://tailscale.com/download
2. Get your machine's Tailscale hostname:
   ```bash
   tailscale status
   # e.g., erics-mbp.tail1234.ts.net
   ```
3. Generate a TLS certificate:
   ```bash
   tailscale cert erics-mbp.tail1234.ts.net
   ```
4. Install `local-ssl-proxy` to terminate TLS:
   ```bash
   npm install -g local-ssl-proxy
   local-ssl-proxy \
     --source 8443 \
     --target 3010 \
     --cert erics-mbp.tail1234.ts.net.crt \
     --key erics-mbp.tail1234.ts.net.key
   ```
5. Access from any device on your Tailnet:
   ```
   https://erics-mbp.tail1234.ts.net:8443
   ```

### Gateway Token

If your OCPlatform gateway requires a token, set it in the ControlSuite settings or pass it as a query parameter:

```
https://erics-mbp.tail1234.ts.net:8443?token=YOUR_GATEWAY_TOKEN
```

## Option 2: Local Network (LAN)

1. Find your server's local IP:
   ```bash
   # macOS
   ipconfig getifaddr en0
   # Linux
   hostname -I | awk '{print $1}'
   ```
2. Access from any device on the same network:
   ```
   http://192.168.1.100:3010
   ```

> **Note:** HTTP (not HTTPS) works on LAN but some browser features (clipboard, notifications) require a secure context.

## Option 3: Docker

The included `docker-compose.yml` exposes port 3000 (the production build defaults to PORT=3000; this is intentional and distinct from the dev server on 3010). For remote access, combine with Tailscale or a reverse proxy (nginx, Caddy, Traefik).

## Windows Notes

- Use WSL2 for running ControlSuite
- Tailscale works on Windows natively — install on both WSL2 and Windows host
- If using WSL2, you may need to forward the port:
  ```powershell
  netsh interface portproxy add v4tov4 listenport=3010 listenaddress=0.0.0.0 connectport=3010 connectaddress=$(wsl hostname -I)
  ```

## Troubleshooting

- **CORS errors**: ControlSuite serves from localhost by default. When accessing remotely, ensure the gateway URL in settings points to the correct host.
- **WebSocket disconnects**: Check that your proxy/Tailscale forwards WebSocket connections (Tailscale does this by default).
- **Slow on mobile**: Reduce polling intervals in Settings → Performance if available.
