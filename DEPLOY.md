# Scribblr Deployment Guide

Deploy Scribblr with Cloudflare Tunnel for secure access.

## Prerequisites

- Docker and Docker Compose installed
- Cloudflare account with domain added
- Domain nameservers pointing to Cloudflare

## Step 1: Clone and Configure

```bash
git clone git@github.com:stolmine/rustpad-stolmine.git
cd rustpad-stolmine
cp .env.example .env
```

## Step 2: Create Cloudflare Tunnel

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navigate to **Networks → Tunnels → Create a tunnel**
3. Name: `scribblr`
4. Copy the tunnel token

5. Edit `.env` and add your token:
   ```
   TUNNEL_TOKEN=eyJhIjoiNmY4ZD...your_token_here
   ```

6. In the tunnel config, add a **Public Hostname**:
   - Subdomain: (leave blank for root, or use `www`)
   - Domain: `scribblr.name`
   - Service Type: `HTTP`
   - URL: `scribblr:3030`

## Step 3: Configure Access (Authentication)

1. In Zero Trust dashboard, go to **Access → Applications → Add an application**
2. Select **Self-hosted**
3. Application name: `Scribblr`
4. Session duration: `24 hours`
5. Application domain: `scribblr.name`

6. Add a policy:
   - Policy name: `Allowed Users`
   - Action: `Allow`
   - Include: `Emails` → add authorized email addresses

7. Under **Authentication**, ensure **One-time PIN** is enabled (Settings → Authentication)

## Step 4: Build and Run

```bash
# Build and start containers
docker compose up -d

# Check logs
docker compose logs -f

# Verify containers are running
docker compose ps
```

## Step 5: Verify Deployment

1. Visit `https://scribblr.name`
2. You should see Cloudflare Access login
3. Enter your email → check inbox for PIN → enter PIN
4. Scribblr should load

## Common Commands

```bash
# Stop
docker compose down

# Restart
docker compose restart

# Rebuild after code changes
docker compose up -d --build

# View logs
docker compose logs -f scribblr
docker compose logs -f cloudflared

# Check container status
docker compose ps
```

## Troubleshooting

### "Connection refused" or tunnel not connecting
- Check `docker compose logs cloudflared`
- Verify `TUNNEL_TOKEN` in `.env` is correct
- Ensure tunnel is active in Cloudflare dashboard

### App loads but WebSocket fails
- In Cloudflare tunnel config, ensure the service URL is `http://scribblr:3030` (not https)
- Check that the tunnel hostname matches your domain exactly

### Database issues
- Data is stored in a Docker volume `scribblr-data`
- To reset: `docker compose down -v` (warning: deletes all notes)

### Build fails
- Ensure Docker has enough memory (4GB+ recommended)
- Try `docker compose build --no-cache`

## Data Backup

The SQLite database is stored in the `scribblr-data` Docker volume.

```bash
# Backup
docker compose exec scribblr cat /data/scribblr.db > backup.db

# Or copy from volume directly
docker cp $(docker compose ps -q scribblr):/data/scribblr.db ./backup.db
```

## Architecture

```
Internet
    ↓
Cloudflare Edge (HTTPS + Access Auth)
    ↓
Cloudflare Tunnel (encrypted)
    ↓
cloudflared container
    ↓
scribblr container (:3030)
    ↓
SQLite database (/data/scribblr.db)
```
