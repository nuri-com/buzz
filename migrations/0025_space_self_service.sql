-- Add human-readable Space name and visibility to communities.
-- Spaces are communities with a user-facing name and public/private visibility.
-- Default is 'private' so existing production communities remain control-plane only.
-- The unique Space slug remains encoded in communities.host.

ALTER TABLE communities
    ADD COLUMN space_name VARCHAR(80),
    ADD COLUMN space_visibility VARCHAR(16) NOT NULL DEFAULT 'private';

-- Constraint: space_visibility must be 'public' or 'private'.
ALTER TABLE communities
    ADD CONSTRAINT chk_communities_space_visibility
        CHECK (space_visibility IN ('public', 'private'));

-- Display names are human text. DNS-label validation belongs to the host slug,
-- not this column.
ALTER TABLE communities
    ADD CONSTRAINT chk_communities_space_name
        CHECK (
            space_name IS NULL
            OR length(btrim(space_name)) BETWEEN 1 AND 80
        );

-- Display-name lookup without falsely requiring names to be globally unique.
CREATE INDEX idx_communities_space_name
    ON communities (lower(space_name))
    WHERE space_name IS NOT NULL;

-- Index for listing public spaces.
CREATE INDEX idx_communities_space_visibility
    ON communities (space_visibility)
    WHERE space_visibility = 'public' AND archived_at IS NULL;
