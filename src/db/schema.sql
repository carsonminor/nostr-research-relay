-- Research Journal Relay Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Events table for storing all Nostr events
CREATE TABLE events (
    id VARCHAR(64) PRIMARY KEY,
    pubkey VARCHAR(64) NOT NULL,
    created_at BIGINT NOT NULL,
    kind INTEGER NOT NULL,
    tags JSONB NOT NULL DEFAULT '[]',
    content TEXT NOT NULL,
    sig VARCHAR(128) NOT NULL,
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX_created_at_kind ON events(created_at, kind),
    INDEX_pubkey_kind ON events(pubkey, kind)
);

-- Research papers metadata
CREATE TABLE research_papers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id VARCHAR(64) UNIQUE REFERENCES events(id),
    title TEXT NOT NULL,
    authors JSONB NOT NULL DEFAULT '[]',
    abstract TEXT,
    status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'accepted', 'rejected', 'published')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP,
    size_bytes BIGINT NOT NULL,
    payment_hash VARCHAR(64),
    price_paid BIGINT,
    reviewer_notes TEXT,
    file_path TEXT
);

-- Lightning invoices
CREATE TABLE lightning_invoices (
    payment_hash VARCHAR(64) PRIMARY KEY,
    payment_request TEXT NOT NULL,
    amount_sats BIGINT NOT NULL,
    description TEXT,
    expires_at TIMESTAMP NOT NULL,
    paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subscriptions for WebSocket connections
CREATE TABLE subscriptions (
    id VARCHAR(64) PRIMARY KEY,
    connection_id VARCHAR(64) NOT NULL,
    filters JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Relay configuration
CREATE TABLE relay_config (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration
INSERT INTO relay_config (key, value) VALUES 
('price_per_mb_year', '1000'),
('price_per_comment_mb', '100'),
('max_content_size', '52428800'),
('relay_name', 'Research Journal Relay'),
('relay_description', 'Academic research papers on Nostr with peer review')
ON CONFLICT DO NOTHING;

-- Indexes for performance
CREATE INDEX idx_events_kind_created ON events(kind, created_at DESC);
CREATE INDEX idx_events_pubkey_created ON events(pubkey, created_at DESC);
CREATE INDEX idx_research_papers_status ON research_papers(status);
CREATE INDEX idx_research_papers_created ON research_papers(created_at DESC);
CREATE INDEX idx_lightning_invoices_expires ON lightning_invoices(expires_at);
CREATE INDEX idx_subscriptions_connection ON subscriptions(connection_id);