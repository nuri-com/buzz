//! Nuri Space self-service HTTP API.
//!
//! All routes are NIP-98 signed and available only on the deployment hub host:
//!
//! - `GET /api/nuri/spaces` lists public Spaces plus the caller's memberships.
//! - `POST /api/nuri/spaces` creates a Space owned by the caller.
//! - `POST /api/nuri/spaces/join` joins a public Space.
//!
//! Private Spaces continue to use the existing tenant-bound invite claim API.

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json,
};
use buzz_core::{normalize_host, TenantContext};
use nostr::PublicKey;
use serde::Deserialize;
use serde_json::Value;

use crate::handlers::side_effects::{publish_nip43_member_added, publish_nip43_membership_list};
use crate::state::AppState;

use super::{api_error, bridge, internal_error};

/// Body for `POST /api/nuri/spaces`.
#[derive(Debug, Deserialize)]
pub struct CreateSpaceRequest {
    /// Human-readable display name.
    pub name: String,
    /// Lowercase DNS label used in `<slug>.relay.nuri.com`.
    pub slug: String,
    /// Either `public` or `private`.
    pub visibility: String,
}

/// Body for `POST /api/nuri/spaces/join`.
#[derive(Debug, Deserialize)]
pub struct JoinSpaceRequest {
    /// Public Space slug to join.
    pub slug: String,
}

fn hub_host_matches(config_relay_url: &str, raw_host: &str) -> bool {
    let expected = buzz_core::tenant::relay_url_authority(config_relay_url);
    !expected.is_empty() && normalize_host(raw_host) == expected
}

async fn authenticate_hub(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> Result<(TenantContext, PublicKey), (StatusCode, Json<Value>)> {
    let raw_host = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !hub_host_matches(&state.config.relay_url, raw_host) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "space endpoints are only available on the hub host",
        ));
    }

    let tenant = crate::tenant::bind_community(&state.db, raw_host)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::NOT_FOUND,
                "relay: no community is configured for this host",
            )
        })?;
    let url = bridge::nip98_expected_url(&state.config.relay_url, &tenant, path);
    let (pubkey, event_id_bytes) =
        bridge::verify_bridge_auth_with_options(headers, method, &url, body, true, body.is_some())?;
    bridge::check_nip98_replay(state, &tenant, event_id_bytes).await?;
    Ok((tenant, pubkey))
}

async fn require_hub_member(
    state: &AppState,
    tenant: &TenantContext,
    signer: &PublicKey,
) -> Result<String, (StatusCode, Json<Value>)> {
    let signer_hex = signer.to_hex();
    let is_member = state
        .db
        .is_relay_member(tenant.community(), &signer_hex)
        .await
        .map_err(|error| internal_error(&format!("hub membership check: {error}")))?;
    if !is_member {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "you must be a Nuri member of the hub",
        ));
    }
    Ok(signer_hex)
}

fn validate_slug(slug: &str) -> Result<(), (StatusCode, Json<Value>)> {
    buzz_db::space::validate_space_slug(slug)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid Space slug"))
}

fn slug_from_host(host: &str) -> Result<&str, (StatusCode, Json<Value>)> {
    host.strip_suffix(buzz_db::space::SPACE_HOST_SUFFIX)
        .ok_or_else(|| internal_error("stored Space host has an invalid suffix"))
}

/// `GET /api/nuri/spaces` — list public Spaces plus the caller's memberships.
pub async fn list_spaces(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (tenant, signer) =
        authenticate_hub(&state, &headers, "GET", "/api/nuri/spaces", None).await?;
    let signer_hex = require_hub_member(&state, &tenant, &signer).await?;
    let spaces = state
        .db
        .list_spaces(Some(&signer_hex))
        .await
        .map_err(|error| internal_error(&format!("list Spaces: {error}")))?;

    let mut result = Vec::with_capacity(spaces.len());
    for space in spaces {
        let slug = slug_from_host(&space.host)?;
        let is_member = space.role.is_some();
        result.push(serde_json::json!({
            "community_id": space.community_id.to_string(),
            "name": space.space_name,
            "slug": slug,
            "host": space.host,
            "relay_url": format!("wss://{}", space.host),
            "visibility": space.space_visibility,
            "role": space.role,
            "is_member": is_member,
            "general_channel_id": space.general_channel_id.to_string(),
            "created_at": space.created_at.to_rfc3339(),
        }));
    }

    Ok(Json(serde_json::json!({ "spaces": result })))
}

/// `POST /api/nuri/spaces` — atomically create a Space owned by the signer.
pub async fn create_space(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (tenant, signer) =
        authenticate_hub(&state, &headers, "POST", "/api/nuri/spaces", Some(&body)).await?;
    let signer_hex = require_hub_member(&state, &tenant, &signer).await?;
    let request: CreateSpaceRequest = serde_json::from_slice(&body).map_err(|error| {
        api_error(
            StatusCode::BAD_REQUEST,
            &format!("invalid create-Space JSON: {error}"),
        )
    })?;
    validate_slug(&request.slug)?;

    let name = request.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Space name must be 1-80 characters",
        ));
    }
    if request.visibility != "public" && request.visibility != "private" {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "visibility must be public or private",
        ));
    }

    match state
        .db
        .create_space(&request.slug, name, &request.visibility, &signer_hex)
        .await
        .map_err(|error| internal_error(&format!("create Space: {error}")))?
    {
        buzz_db::space::CreateSpaceResult::Created {
            community_id,
            host,
            general_channel_id,
        } => {
            let space_tenant = TenantContext::resolved(community_id, &host);
            if let Err(error) = publish_nip43_member_added(&space_tenant, &state, &signer_hex).await
            {
                tracing::warn!(%error, "failed to publish Space owner delta");
            }
            if let Err(error) = publish_nip43_membership_list(&space_tenant, &state).await {
                tracing::warn!(%error, "failed to publish Space membership list");
            }

            Ok(Json(serde_json::json!({
                "community_id": community_id.to_string(),
                "name": name,
                "slug": request.slug,
                "host": host,
                "relay_url": format!("wss://{host}"),
                "visibility": request.visibility,
                "role": "owner",
                "is_member": true,
                "general_channel_id": general_channel_id.to_string(),
            })))
        }
        buzz_db::space::CreateSpaceResult::SlugExists => Err(api_error(
            StatusCode::CONFLICT,
            "a Space with this slug already exists",
        )),
        buzz_db::space::CreateSpaceResult::LimitReached => Err(api_error(
            StatusCode::CONFLICT,
            "you have reached the maximum number of Spaces you can own",
        )),
    }
}

/// `POST /api/nuri/spaces/join` — idempotently join a public Space.
pub async fn join_space(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (tenant, signer) = authenticate_hub(
        &state,
        &headers,
        "POST",
        "/api/nuri/spaces/join",
        Some(&body),
    )
    .await?;
    let signer_hex = require_hub_member(&state, &tenant, &signer).await?;
    let request: JoinSpaceRequest = serde_json::from_slice(&body).map_err(|error| {
        api_error(
            StatusCode::BAD_REQUEST,
            &format!("invalid join-Space JSON: {error}"),
        )
    })?;
    validate_slug(&request.slug)?;

    let (target_community, visibility, target_host, name, general_channel_id) = state
        .db
        .lookup_space_by_slug(&request.slug)
        .await
        .map_err(|error| internal_error(&format!("lookup Space: {error}")))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "Space not found"))?;
    if visibility != "public" {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "this Space is private; use an invite to join",
        ));
    }

    let was_inserted = state
        .db
        .join_space(target_community, &signer_hex)
        .await
        .map_err(|error| internal_error(&format!("join Space: {error}")))?;
    let role = state
        .db
        .get_relay_member(target_community, &signer_hex)
        .await
        .map_err(|error| internal_error(&format!("joined role lookup: {error}")))?
        .map(|member| member.role)
        .ok_or_else(|| api_error(StatusCode::CONFLICT, "Space is no longer public"))?;

    if was_inserted {
        let space_tenant = TenantContext::resolved(target_community, &target_host);
        if let Err(error) = publish_nip43_member_added(&space_tenant, &state, &signer_hex).await {
            tracing::warn!(%error, "failed to publish Space member delta");
        }
        if let Err(error) = publish_nip43_membership_list(&space_tenant, &state).await {
            tracing::warn!(%error, "failed to publish Space membership list");
        }
    }

    Ok(Json(serde_json::json!({
        "community_id": target_community.to_string(),
        "name": name,
        "slug": request.slug,
        "host": target_host,
        "relay_url": format!("wss://{target_host}"),
        "visibility": visibility,
        "role": role,
        "is_member": true,
        "general_channel_id": general_channel_id.to_string(),
        "status": if was_inserted { "joined" } else { "already_member" },
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hub_host_comparison_uses_canonical_host_rules() {
        assert!(hub_host_matches(
            "wss://relay.nuri.com",
            "Relay.Nuri.Com:443"
        ));
        assert!(!hub_host_matches(
            "wss://relay.nuri.com",
            "space.relay.nuri.com"
        ));
    }

    #[test]
    fn slug_validation_and_suffix_are_exact() {
        assert!(validate_slug("nuri-builders").is_ok());
        assert!(validate_slug("Nuri-Builders").is_err());
        assert_eq!(
            buzz_db::space::space_host_from_slug("nuri-builders"),
            "nuri-builders.relay.nuri.com"
        );
    }
}
