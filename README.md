# Nostr Research Journal Relay

A specialized Nostr relay for academic research papers with Lightning Network payments and peer review functionality.

## Features

- **NIP-23 Long-form Content**: Support for academic research papers
- **NIP-22 Comments**: Threaded discussions on papers
- **Lightning Payments**: Pay-to-publish model with Lightning Network
- **Peer Review Workflow**: Status tracking (submitted → under review → accepted → published)
- **Large Content Storage**: Designed for multi-MB research papers
- **Admin Interface**: Content management and pricing controls
- **Public API**: Free read access for published content

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL
- LND Lightning node (optional - will run in mock mode without)

### Installation

1. Clone and install dependencies:
```bash
git clone <repo-url>
cd nostr-research-relay
npm install
```

2. Set up environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Set up database:
```bash
createdb nostr_research
```

4. Build and start:
```bash
npm run build
npm start
```

For development:
```bash
npm run dev
```

## Configuration

Key environment variables:

- `DATABASE_URL`: PostgreSQL connection string
- `LND_HOST`: Lightning node host (optional)
- `LND_MACAROON_PATH`: Path to LND macaroon file (optional)
- `LND_TLS_CERT_PATH`: Path to LND TLS certificate (optional)
- `PORT`: Server port (default: 8080)
- `HOST`: Bind address (default: 0.0.0.0 for external access, use localhost for local only)
- `STORAGE_PATH`: File storage directory (default: ./storage)

### Network Access

To make the relay accessible from other computers:

1. Set `HOST=0.0.0.0` in your `.env` file (default)
2. Find your computer's IP address: `ip addr show` (Linux) or `ifconfig` (macOS)
3. Access from other computers using: `http://<your-ip>:8080`

**Important**: Make sure port 8080 is not blocked by your firewall:
```bash
# Ubuntu/Debian
sudo ufw allow 8080

# macOS
# System Settings → Network → Firewall → Allow port 8080

# Windows
# Windows Defender Firewall → Allow app through firewall
```

## API Endpoints

### Public Endpoints

- `GET /` - Relay information (NIP-11)
- `GET /api/info` - Detailed relay info including pricing
- `GET /api/papers` - List published papers
- `GET /api/papers/:event_id/content` - Get paper content
- `POST /api/pricing` - Calculate pricing for content size
- `POST /api/invoice` - Create Lightning invoice for research paper
- `POST /api/comment-invoice` - Create Lightning invoice for comment
- `GET /api/payment/:payment_hash` - Check payment status

### Admin Endpoints

- `GET /api/admin/papers` - List all papers (all statuses)
- `PUT /api/admin/papers/:event_id/status` - Update paper status
- `PUT /api/admin/pricing` - Update pricing configuration

## WebSocket Protocol

Supports standard Nostr relay protocol:

- `["EVENT", event]` - Submit events
- `["REQ", subscription_id, ...filters]` - Request events
- `["CLOSE", subscription_id]` - Close subscription

### Research Paper Submission Flow

1. Client calculates content size and gets pricing
2. Client submits NIP-23 event (kind 30023)
3. Relay responds with pricing information
4. Client requests Lightning invoice
5. Client pays invoice
6. Relay updates paper status to "under_review"
7. Admin reviews and updates status to "accepted"/"rejected"
8. If accepted, admin publishes (status: "published")

## Event Kinds

- `30023`: Research papers (NIP-23 long-form content)
- `1111`: Comments (NIP-22 comments)

## Database Schema

- `events`: All Nostr events
- `research_papers`: Paper metadata and status
- `lightning_invoices`: Payment tracking
- `relay_config`: Configuration settings

## Lightning Integration

The relay integrates with LND for Lightning payments:

- Creates invoices for storage fees
- Verifies payments before accepting content
- Supports both live LND and mock mode for development

## Development

Run tests:
```bash
npm test
```

Lint code:
```bash
npm run lint
```

## License

MIT