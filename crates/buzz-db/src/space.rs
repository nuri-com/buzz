//! Space self-service persistence — create, list, and join Spaces.
//!
//! A Space is a community with a human-readable `space_name` and
//! `space_visibility` (public/private). The host is derived from the slug:
//! `<slug>.relay.nuri.com`. Creating a Space atomically bootstraps the
//! signer as owner, creates a #general stream channel, and adds the owner
//! as a channel member. Joining a public Space adds the signer as a relay
//! member of the target community.

use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::error::{DbError, Result};
use crate::relay_members::{self, MAX_COMMUNITIES_PER_OWNER};
use crate::CommunityId;

/// A Space as returned by list queries.
#[derive(Debug, Clone)]
pub struct SpaceRecord {
    /// Stable server-resolved community id.
    pub community_id: CommunityId,
    /// Human-readable Space display name.
    pub space_name: String,
    /// Visibility: "public" or "private".
    pub space_visibility: String,
    /// Full host derived from the slug.
    pub host: String,
    /// When the space was created.
    pub created_at: DateTime<Utc>,
    /// The caller's role in this space, if they are a relay member.
    pub role: Option<String>,
    /// Server-confirmed bootstrap #general channel.
    pub general_channel_id: Uuid,
}

/// Result of atomically creating a Space.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreateSpaceResult {
    /// The Space was created.
    Created {
        /// Community id of the new Space.
        community_id: CommunityId,
        /// The full host.
        host: String,
        /// The #general channel id.
        general_channel_id: Uuid,
    },
    /// The slug (and therefore host) is already taken.
    SlugExists,
    /// The owner already owns the maximum number of communities.
    LimitReached,
}

/// The public suffix appended to the slug to form the community host.
pub const SPACE_HOST_SUFFIX: &str = ".relay.nuri.com";

/// Validate that a slug is a lowercase DNS label: 1-63 chars, alphanumeric
/// plus hyphens, no leading/trailing hyphens.
pub fn validate_space_slug(slug: &str) -> Result<()> {
    if slug.is_empty() || slug.len() > 63 {
        return Err(DbError::InvalidData(
            "space slug must be 1-63 characters".into(),
        ));
    }
    let bytes = slug.as_bytes();
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return Err(DbError::InvalidData(
            "space slug must start with a lowercase letter or digit".into(),
        ));
    }
    if !bytes[bytes.len() - 1].is_ascii_lowercase() && !bytes[bytes.len() - 1].is_ascii_digit() {
        return Err(DbError::InvalidData(
            "space slug must end with a lowercase letter or digit".into(),
        ));
    }
    for &b in bytes {
        if !b.is_ascii_lowercase() && !b.is_ascii_digit() && b != b'-' {
            return Err(DbError::InvalidData(format!(
                "space slug contains invalid character '{}'",
                b as char
            )));
        }
    }
    Ok(())
}

/// Build the full community host from a slug.
pub fn space_host_from_slug(slug: &str) -> String {
    format!("{slug}{SPACE_HOST_SUFFIX}")
}

/// Atomically create a Space: community row with space_name + visibility,
/// owner relay membership, and a #general stream channel with owner membership.
///
/// Enforces `MAX_COMMUNITIES_PER_OWNER` and host collision semantics via
/// the same advisory-lock pattern as `create_community_with_owner`.
pub async fn create_space(
    pool: &PgPool,
    slug: &str,
    space_name: &str,
    visibility: &str,
    owner_pubkey: &str,
) -> Result<CreateSpaceResult> {
    validate_space_slug(slug)?;
    let space_name = space_name.trim();
    if space_name.is_empty() || space_name.chars().count() > 80 {
        return Err(DbError::InvalidData(
            "space name must be 1-80 characters".into(),
        ));
    }
    if visibility != "public" && visibility != "private" {
        return Err(DbError::InvalidData(
            "space visibility must be public or private".into(),
        ));
    }
    if owner_pubkey.len() != 64 || !owner_pubkey.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(DbError::InvalidData(
            "owner pubkey must be 64 hexadecimal characters".into(),
        ));
    }
    let host = space_host_from_slug(slug);
    let owner_pubkey = owner_pubkey.to_ascii_lowercase();

    let mut tx = pool.begin().await?;

    // Serialize on the owner pubkey so concurrent creates to the same
    // owner cannot both pass the ownership count check.
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(relay_members::owner_count_advisory_lock_key(&owner_pubkey))
        .execute(&mut *tx)
        .await?;

    // Try to insert the community row with space fields.
    let row = sqlx::query(
        r#"
        INSERT INTO communities (host, space_name, space_visibility)
        VALUES ($1, $2, $3)
        ON CONFLICT (lower(host)) DO NOTHING
        RETURNING id, host
        "#,
    )
    .bind(&host)
    .bind(space_name)
    .bind(visibility)
    .fetch_optional(&mut *tx)
    .await?;

    let (community_id, existing_general_channel_id) = if let Some(row) = row {
        let id: Uuid = row.try_get("id")?;

        // Enforce the per-owner community limit.
        let owned_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM relay_members WHERE pubkey = $1 AND role = 'owner'",
        )
        .bind(&owner_pubkey)
        .fetch_one(&mut *tx)
        .await?;

        if owned_count >= MAX_COMMUNITIES_PER_OWNER {
            tx.rollback().await?;
            return Ok(CreateSpaceResult::LimitReached);
        }

        // Insert owner relay membership.
        sqlx::query(
            "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
             VALUES ($1, $2, 'owner', NULL)",
        )
        .bind(id)
        .bind(&owner_pubkey)
        .execute(&mut *tx)
        .await?;

        (CommunityId::from_uuid(id), None)
    } else {
        // Identical retries by the same owner recover the already-created
        // Space. A different owner or different metadata remains a collision.
        let existing = sqlx::query(
            r#"
            SELECT c.id, ch.id AS general_channel_id
            FROM communities c
            JOIN relay_members rm
              ON rm.community_id = c.id
             AND lower(rm.pubkey) = lower($2)
             AND rm.role = 'owner'
            JOIN channels ch
              ON ch.community_id = c.id
             AND ch.name = 'general'
             AND ch.channel_type = 'stream'
             AND ch.archived_at IS NULL
            WHERE lower(c.host) = lower($1)
              AND c.space_name = $3
              AND c.space_visibility = $4
              AND c.archived_at IS NULL
            "#,
        )
        .bind(&host)
        .bind(&owner_pubkey)
        .bind(space_name)
        .bind(visibility)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(existing) = existing else {
            tx.rollback().await?;
            return Ok(CreateSpaceResult::SlugExists);
        };
        (
            CommunityId::from_uuid(existing.try_get("id")?),
            Some(existing.try_get("general_channel_id")?),
        )
    };

    if let Some(general_channel_id) = existing_general_channel_id {
        tx.commit().await?;
        return Ok(CreateSpaceResult::Created {
            community_id,
            host,
            general_channel_id,
        });
    }

    // Create the #general stream channel with owner membership.
    let channel_id = Uuid::new_v4();
    let owner_bytes = hex::decode(&owner_pubkey)
        .map_err(|_| DbError::InvalidData("invalid owner pubkey hex".into()))?;

    sqlx::query(
        r#"
        INSERT INTO channels (id, community_id, name, channel_type, visibility, created_by)
        VALUES ($1, $2, 'general', 'stream'::channel_type, 'open'::channel_visibility, $3)
        "#,
    )
    .bind(channel_id)
    .bind(community_id.as_uuid())
    .bind(&owner_bytes)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO channel_members (community_id, channel_id, pubkey, role, invited_by)
        VALUES ($1, $2, $3, 'owner', $4)
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(channel_id)
    .bind(&owner_bytes)
    .bind(&owner_bytes)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(CreateSpaceResult::Created {
        community_id,
        host,
        general_channel_id: channel_id,
    })
}

/// List active public Spaces, plus any active Spaces where `member_pubkey`
/// is a relay member (for the caller's own private Spaces).
pub async fn list_spaces(pool: &PgPool, member_pubkey: Option<&str>) -> Result<Vec<SpaceRecord>> {
    let rows = sqlx::query(
        r#"
        SELECT c.id, c.space_name, c.space_visibility, c.host, c.created_at,
               rm.role, ch.id AS general_channel_id
        FROM communities c
        JOIN channels ch
          ON ch.community_id = c.id
         AND ch.name = 'general'
         AND ch.channel_type = 'stream'
         AND ch.archived_at IS NULL
        LEFT JOIN relay_members rm
            ON rm.community_id = c.id
            AND rm.pubkey = $1
        WHERE c.archived_at IS NULL
          AND c.space_name IS NOT NULL
          AND (
              c.space_visibility = 'public'
              OR ($1 IS NOT NULL AND rm.pubkey IS NOT NULL)
          )
        ORDER BY c.created_at DESC
        "#,
    )
    .bind(member_pubkey)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|r| {
            Ok(SpaceRecord {
                community_id: CommunityId::from_uuid(r.try_get("id")?),
                space_name: r.try_get("space_name")?,
                space_visibility: r.try_get("space_visibility")?,
                host: r.try_get("host")?,
                created_at: r.try_get("created_at")?,
                role: r.try_get("role")?,
                general_channel_id: r.try_get("general_channel_id")?,
            })
        })
        .collect()
}

/// Look up a Space by its slug. Returns the community id and visibility
/// if the space exists and is active.
pub async fn lookup_space_by_slug(
    pool: &PgPool,
    slug: &str,
) -> Result<Option<(CommunityId, String, String, String, Uuid)>> {
    validate_space_slug(slug)?;
    let host = space_host_from_slug(slug);
    let row = sqlx::query(
        r#"
        SELECT c.id, c.space_visibility, c.host, c.space_name,
               ch.id AS general_channel_id
        FROM communities c
        JOIN channels ch
          ON ch.community_id = c.id
         AND ch.name = 'general'
         AND ch.channel_type = 'stream'
         AND ch.archived_at IS NULL
        WHERE lower(c.host) = lower($1)
          AND c.archived_at IS NULL
          AND c.space_name IS NOT NULL
        "#,
    )
    .bind(&host)
    .fetch_optional(pool)
    .await?;

    row.map(|r| {
        Ok((
            CommunityId::from_uuid(r.try_get("id")?),
            r.try_get("space_visibility")?,
            r.try_get("host")?,
            r.try_get("space_name")?,
            r.try_get("general_channel_id")?,
        ))
    })
    .transpose()
}

/// Idempotently join a public Space: add the pubkey as a relay member
/// of the target community. Returns `true` if the membership was newly
/// inserted.
pub async fn join_space(pool: &PgPool, community_id: CommunityId, pubkey: &str) -> Result<bool> {
    if pubkey.len() != 64 || !pubkey.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(DbError::InvalidData(
            "member pubkey must be 64 hexadecimal characters".into(),
        ));
    }
    let inserted = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO relay_members (community_id, pubkey, role, added_by)
        SELECT c.id, $2, 'member', NULL
        FROM communities c
        WHERE c.id = $1
          AND c.archived_at IS NULL
          AND c.space_name IS NOT NULL
          AND c.space_visibility = 'public'
        ON CONFLICT (community_id, pubkey) DO NOTHING
        RETURNING pubkey
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(pubkey.to_ascii_lowercase())
    .fetch_optional(pool)
    .await?;
    Ok(inserted.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_valid_lowercase_dns_labels() {
        assert!(validate_space_slug("my-space").is_ok());
        assert!(validate_space_slug("a").is_ok());
        assert!(validate_space_slug("abc123").is_ok());
        assert!(validate_space_slug("test-space-42").is_ok());
    }

    #[test]
    fn slug_rejects_invalid() {
        assert!(validate_space_slug("").is_err());
        assert!(validate_space_slug("-bad").is_err());
        assert!(validate_space_slug("bad-").is_err());
        assert!(validate_space_slug("UPPERCASE").is_err());
        assert!(validate_space_slug("has_underscore").is_err());
        assert!(validate_space_slug("has space").is_err());
        assert!(validate_space_slug(&"a".repeat(64)).is_err());
    }

    #[test]
    fn host_from_slug_appends_suffix() {
        assert_eq!(space_host_from_slug("my-space"), "my-space.relay.nuri.com");
    }

    #[test]
    fn suffix_is_exact() {
        assert_eq!(SPACE_HOST_SUFFIX, ".relay.nuri.com");
    }

    // ── DB integration tests (require Postgres) ──

    mod db_tests {
        use super::*;
        use sqlx::PgPool;
        use uuid::Uuid;

        const TEST_DB_URL: &str = "postgres://buzz:buzz_dev@localhost:5432/buzz";

        async fn setup_pool() -> PgPool {
            let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
                .or_else(|_| std::env::var("DATABASE_URL"))
                .unwrap_or_else(|_| TEST_DB_URL.to_owned());
            PgPool::connect(&database_url)
                .await
                .expect("connect to test DB")
        }

        fn unique_slug() -> String {
            format!("test-space-{}", Uuid::new_v4().simple())
        }

        fn test_pubkey() -> String {
            format!("{:064x}", Uuid::new_v4().as_u128())
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn create_space_returns_created_with_general_channel() {
            let pool = setup_pool().await;
            let slug = unique_slug();
            let owner = test_pubkey();

            let result = create_space(&pool, &slug, "Test Space", "public", &owner)
                .await
                .expect("create space");
            let retry = create_space(&pool, &slug, "Test Space", "public", &owner)
                .await
                .expect("retry create space");
            assert_eq!(retry, result, "identical create must be idempotent");

            let CreateSpaceResult::Created {
                community_id,
                host,
                general_channel_id,
            } = result
            else {
                panic!("expected Created, got {:?}", result);
            };

            assert_eq!(host, space_host_from_slug(&slug));

            // Owner is a relay member with owner role.
            let role: Option<String> = sqlx::query_scalar(
                "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2",
            )
            .bind(community_id.as_uuid())
            .bind(&owner)
            .fetch_optional(&pool)
            .await
            .expect("owner role query");
            assert_eq!(role.as_deref(), Some("owner"));

            // #general channel exists.
            let channel_name: Option<String> =
                sqlx::query_scalar("SELECT name FROM channels WHERE community_id = $1 AND id = $2")
                    .bind(community_id.as_uuid())
                    .bind(general_channel_id)
                    .fetch_optional(&pool)
                    .await
                    .expect("channel query");
            assert_eq!(channel_name.as_deref(), Some("general"));

            // Owner is a channel member with owner role.
            let owner_bytes = hex::decode(&owner).expect("decode owner pubkey");
            let channel_role: Option<String> = sqlx::query_scalar(
                "SELECT role::text FROM channel_members WHERE community_id = $1 AND channel_id = $2 AND pubkey = $3",
            )
            .bind(community_id.as_uuid())
            .bind(general_channel_id)
            .bind(&owner_bytes)
            .fetch_optional(&pool)
            .await
            .expect("channel member query");
            assert_eq!(channel_role.as_deref(), Some("owner"));
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn create_space_rejects_duplicate_slug() {
            let pool = setup_pool().await;
            let slug = unique_slug();
            let owner_a = test_pubkey();
            let owner_b = test_pubkey();

            let first = create_space(&pool, &slug, "First", "public", &owner_a)
                .await
                .expect("first create");
            assert!(matches!(first, CreateSpaceResult::Created { .. }));

            let second = create_space(&pool, &slug, "Second", "public", &owner_b)
                .await
                .expect("second create");
            assert_eq!(second, CreateSpaceResult::SlugExists);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn concurrent_slug_collision_creates_exactly_one_space() {
            let pool = setup_pool().await;
            let slug = unique_slug();
            let owner_a = test_pubkey();
            let owner_b = test_pubkey();

            let (first, second) = tokio::join!(
                create_space(&pool, &slug, "Concurrent Space", "public", &owner_a),
                create_space(&pool, &slug, "Concurrent Space", "public", &owner_b),
            );
            let results = [first.expect("first create"), second.expect("second create")];
            assert_eq!(
                results
                    .iter()
                    .filter(|result| matches!(result, CreateSpaceResult::Created { .. }))
                    .count(),
                1
            );
            assert_eq!(
                results
                    .iter()
                    .filter(|result| matches!(result, CreateSpaceResult::SlugExists))
                    .count(),
                1
            );

            let owner_count: i64 = sqlx::query_scalar(
                r#"
                SELECT count(*)
                FROM relay_members rm
                JOIN communities c ON c.id = rm.community_id
                WHERE lower(c.host) = lower($1) AND rm.role = 'owner'
                "#,
            )
            .bind(space_host_from_slug(&slug))
            .fetch_one(&pool)
            .await
            .expect("owner count");
            assert_eq!(owner_count, 1);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn create_space_enforces_owner_quota() {
            let pool = setup_pool().await;
            let owner = test_pubkey();

            // Create MAX_COMMUNITIES_PER_OWNER spaces.
            for i in 0..MAX_COMMUNITIES_PER_OWNER {
                let slug = format!("quota-{}-{}", i, Uuid::new_v4().simple());
                let result = create_space(&pool, &slug, "Quota Test", "public", &owner)
                    .await
                    .expect("create space within quota");
                assert!(
                    matches!(result, CreateSpaceResult::Created { .. }),
                    "space {i} should be created"
                );
            }

            // The next one should hit the limit.
            let slug = format!("quota-over-{}", Uuid::new_v4().simple());
            let result = create_space(&pool, &slug, "Over Quota", "public", &owner)
                .await
                .expect("create space over quota");
            assert_eq!(result, CreateSpaceResult::LimitReached);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn list_spaces_returns_public_and_own_private() {
            let pool = setup_pool().await;
            let owner_a = test_pubkey();
            let owner_b = test_pubkey();
            let slug_public = unique_slug();
            let slug_private = unique_slug();

            // Create a public space owned by A.
            let result = create_space(&pool, &slug_public, "Public Space", "public", &owner_a)
                .await
                .expect("create public space");
            let CreateSpaceResult::Created {
                community_id: public_id,
                ..
            } = result
            else {
                panic!("expected Created");
            };

            // Create a private space owned by B.
            let result = create_space(&pool, &slug_private, "Private Space", "private", &owner_b)
                .await
                .expect("create private space");
            let CreateSpaceResult::Created {
                community_id: private_id,
                ..
            } = result
            else {
                panic!("expected Created");
            };

            // B can see the public space and their own private space.
            let b_spaces = list_spaces(&pool, Some(&owner_b))
                .await
                .expect("list spaces for B");
            let b_ids: Vec<_> = b_spaces.iter().map(|s| s.community_id).collect();
            assert!(b_ids.contains(&public_id), "B should see the public space");
            assert!(
                b_ids.contains(&private_id),
                "B should see their own private space"
            );

            // An outsider (not a member of either) sees only the public space.
            let outsider = test_pubkey();
            let outsider_spaces = list_spaces(&pool, Some(&outsider))
                .await
                .expect("list spaces for outsider");
            let outsider_ids: Vec<_> = outsider_spaces.iter().map(|s| s.community_id).collect();
            assert!(
                outsider_ids.contains(&public_id),
                "outsider should see the public space"
            );
            assert!(
                !outsider_ids.contains(&private_id),
                "outsider should NOT see the private space"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn join_space_is_idempotent() {
            let pool = setup_pool().await;
            let slug = unique_slug();
            let owner = test_pubkey();
            let joiner = test_pubkey();

            let result = create_space(&pool, &slug, "Join Test", "public", &owner)
                .await
                .expect("create space");
            let CreateSpaceResult::Created { community_id, .. } = result else {
                panic!("expected Created");
            };

            // First join inserts.
            let first = join_space(&pool, community_id, &joiner)
                .await
                .expect("first join");
            assert!(first, "first join should insert");

            // Second join is idempotent.
            let second = join_space(&pool, community_id, &joiner)
                .await
                .expect("second join");
            assert!(!second, "second join should be idempotent");

            // Joiner is a relay member.
            let is_member = relay_members::is_relay_member(&pool, community_id, &joiner)
                .await
                .expect("is member check");
            assert!(is_member);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn lookup_space_by_slug_finds_active_space() {
            let pool = setup_pool().await;
            let slug = unique_slug();
            let owner = test_pubkey();

            create_space(&pool, &slug, "Lookup Test", "public", &owner)
                .await
                .expect("create space");

            let found = lookup_space_by_slug(&pool, &slug).await.expect("lookup");
            assert!(found.is_some());
            let (_, visibility, host, name, general_channel_id) = found.unwrap();
            assert_eq!(visibility, "public");
            assert_eq!(host, space_host_from_slug(&slug));
            assert_eq!(name, "Lookup Test");
            assert_ne!(general_channel_id, Uuid::nil());
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn lookup_space_by_slug_returns_none_for_unknown() {
            let pool = setup_pool().await;
            let found = lookup_space_by_slug(&pool, "nonexistent-99999")
                .await
                .expect("lookup");
            assert!(found.is_none());
        }
    }
}
