CREATE TABLE IF NOT EXISTS links (
    code        VARCHAR(32)   PRIMARY KEY,
    url         VARCHAR(2048) NOT NULL,
    hits        BIGINT        NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    last_hit_at TIMESTAMPTZ
);
