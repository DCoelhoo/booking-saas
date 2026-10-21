-- Migration number: 0001 	 2026-10-21T10:44:53.691Z

-- Ativar validação das relações
PRAGMA foreign_keys = ON;

-- Negócios que utilizam a plataforma
CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Serviços de cada negócio
CREATE TABLE services (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL
        CHECK (duration_minutes > 0),
    price_cents INTEGER NOT NULL
        CHECK (price_cents >= 0),
    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
);

-- Marcações de cada negócio
CREATE TABLE bookings (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (organization_id)
        REFERENCES organizations(id),

    FOREIGN KEY (service_id)
        REFERENCES services(id),

    CHECK (end_at > start_at)
);

-- Índices para pesquisas frequentes
CREATE INDEX idx_services_organization
ON services(organization_id);

CREATE INDEX idx_bookings_organization_start
ON bookings(organization_id, start_at);
