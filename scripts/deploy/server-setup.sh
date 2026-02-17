#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu server (tested on Ubuntu 22.04/24.04)
# Run as root: curl -sSL <this-script> | bash
set -euo pipefail

echo "==> Installing Docker"
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin git

echo "==> Creating deploy user"
useradd -m -s /bin/bash deploy || true
usermod -aG docker deploy

echo "==> Cloning repo to /opt/recon"
mkdir -p /opt/recon
git clone https://github.com/npow/recon.git /opt/recon || echo "Repo already cloned"
chown -R deploy:deploy /opt/recon

echo "==> Creating CLIProxyAPI config directories"
mkdir -p /home/deploy/.cli-proxy-api
chown -R deploy:deploy /home/deploy/.cli-proxy-api

echo ""
echo "========================================="
echo "  Server setup complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Copy OAuth credentials from your local machine:"
echo "   scp -r ~/.cli-proxy-api/ deploy@$(hostname -I | awk '{print $1}'):/home/deploy/.cli-proxy-api/"
echo "   scp /opt/homebrew/etc/cliproxyapi.conf deploy@$(hostname -I | awk '{print $1}'):/opt/recon/cliproxyapi.conf"
echo ""
echo "2. Edit cliproxyapi.conf on the server if needed"
echo ""
echo "3. Set up DNS: point your domain to $(hostname -I | awk '{print $1}')"
echo ""
echo "4. Create .env in /opt/recon:"
echo "   CLIPROXY_API_KEY=your-api-key-1"
echo "   GEMINI_API_KEY=your-gemini-key"
echo "   DOMAIN=recon.example.com"
echo ""
echo "5. Deploy: cd /opt/recon && docker compose up -d --build"
echo ""
echo "6. Add SSH key for deploy user and set GitHub secrets"
