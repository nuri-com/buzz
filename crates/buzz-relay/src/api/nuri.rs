//! Closed-relay registration for Nuri Passkey Wallet identities.
//!
//! NIP-98 proves control of the joining Nostr key. The approved Connect result
//! proves that the same key belongs to a completed Nuri passkey-wallet flow.
//! No PRF output or private key reaches this endpoint.

use std::sync::{Arc, LazyLock};
use std::time::Duration;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json,
};
use nostr::PublicKey;
use serde::Deserialize;
use serde_json::Value;

use crate::handlers::side_effects::{publish_nip43_member_added, publish_nip43_membership_list};
use crate::state::AppState;

use super::{api_error, internal_error};

const CONNECT_BASE_URL: &str = "https://connect.nuri.com";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
struct NuriRegisterRequest {
    session_id: String,
    flow: ConnectFlow,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum ConnectFlow {
    Create,
    Access,
}

#[derive(Debug, Deserialize)]
struct ConnectSessionResult {
    status: String,
    kind: String,
    session_id: String,
    wallet: Option<ConnectWallet>,
}

#[derive(Debug, Deserialize)]
struct ConnectWallet {
    nostr_pubkey_hex: String,
}

#[derive(Debug, PartialEq, Eq)]
enum ConnectApprovalError {
    NotApproved,
    Expired,
    Invalid,
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .timeout(CONNECT_TIMEOUT)
            .build()
            .expect("Nuri Connect HTTP client")
    });
    &CLIENT
}

fn valid_session_id(session_id: &str) -> bool {
    session_id.len() == 64 && session_id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn approved_connect_pubkey(
    result: ConnectSessionResult,
    expected_session_id: &str,
    flow: ConnectFlow,
) -> Result<PublicKey, ConnectApprovalError> {
    match result.status.as_str() {
        "expired" => return Err(ConnectApprovalError::Expired),
        "approved" => {}
        _ => return Err(ConnectApprovalError::NotApproved),
    }
    let expected_kind = match flow {
        ConnectFlow::Create => "create",
        ConnectFlow::Access => "connect",
    };
    if result.session_id != expected_session_id || result.kind != expected_kind {
        return Err(ConnectApprovalError::Invalid);
    }
    let wallet = result.wallet.ok_or(ConnectApprovalError::Invalid)?;
    PublicKey::from_hex(&wallet.nostr_pubkey_hex).map_err(|_| ConnectApprovalError::Invalid)
}

async fn fetch_connect_result(
    session_id: &str,
    flow: ConnectFlow,
) -> Result<ConnectSessionResult, (StatusCode, Json<Value>)> {
    let path = match flow {
        ConnectFlow::Create => "/api/wallet_create_result",
        ConnectFlow::Access => "/api/wallet_connect_result",
    };
    let response = http_client()
        .post(format!("{CONNECT_BASE_URL}{path}"))
        .json(&serde_json::json!({ "session_id": session_id }))
        .send()
        .await
        .map_err(|error| {
            tracing::warn!(%error, "Nuri Connect result request failed");
            api_error(StatusCode::BAD_GATEWAY, "nuri_connect_unavailable")
        })?;

    if !response.status().is_success() {
        tracing::warn!(status = %response.status(), "Nuri Connect result request rejected");
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            "nuri_connect_unavailable",
        ));
    }

    response.json().await.map_err(|error| {
        tracing::warn!(%error, "Nuri Connect returned invalid JSON");
        api_error(StatusCode::BAD_GATEWAY, "nuri_connect_response_invalid")
    })
}

/// `POST /api/nuri/register` — register an approved Nuri wallet as a member.
///
/// The route intentionally runs before relay-membership enforcement, like an
/// invite claim. It still requires payload-bound NIP-98 authentication and its
/// replay protection.
pub async fn register(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (tenant, signer) =
        super::invites::authenticate(&state, &headers, "/api/nuri/register", &body).await?;

    if super::invites::claim_rate_limited(&state, tenant.community(), &signer) {
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "too many registration attempts, slow down",
        ));
    }

    let request: NuriRegisterRequest = serde_json::from_slice(&body).map_err(|error| {
        api_error(
            StatusCode::BAD_REQUEST,
            &format!("invalid registration JSON: {error}"),
        )
    })?;
    if !valid_session_id(&request.session_id) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "connect_session_id_invalid",
        ));
    }

    let connect_result = fetch_connect_result(&request.session_id, request.flow).await?;
    let connect_pubkey = approved_connect_pubkey(connect_result, &request.session_id, request.flow)
        .map_err(|error| match error {
            ConnectApprovalError::Expired => api_error(StatusCode::GONE, "connect_session_expired"),
            ConnectApprovalError::NotApproved => {
                api_error(StatusCode::CONFLICT, "connect_session_not_approved")
            }
            ConnectApprovalError::Invalid => {
                api_error(StatusCode::BAD_GATEWAY, "nuri_connect_response_invalid")
            }
        })?;
    if connect_pubkey != signer {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "connect_wallet_does_not_match_signer",
        ));
    }

    let signer_hex = signer.to_hex();
    let was_inserted = state
        .db
        .add_relay_member(tenant.community(), &signer_hex, "member", None)
        .await
        .map_err(|error| internal_error(&format!("Nuri member insert: {error}")))?;

    if was_inserted {
        tracing::info!(
            community = %tenant.community(),
            member = %signer_hex,
            "relay member added via Nuri Connect"
        );
        if let Err(error) = publish_nip43_member_added(&tenant, &state, &signer_hex).await {
            tracing::warn!(%error, "failed to publish NIP-43 Nuri member delta");
        }
        if let Err(error) = publish_nip43_membership_list(&tenant, &state).await {
            tracing::warn!(%error, "failed to publish NIP-43 list after Nuri registration");
        }
    }

    Ok(Json(serde_json::json!({
        "status": if was_inserted { "registered" } else { "already_member" },
        "community_id": tenant.community().to_string(),
        "host": tenant.host(),
        "role": "member",
        "pubkey": signer_hex,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    fn result(
        status: &str,
        kind: &str,
        session_id: &str,
        pubkey: Option<String>,
    ) -> ConnectSessionResult {
        ConnectSessionResult {
            status: status.to_string(),
            kind: kind.to_string(),
            session_id: session_id.to_string(),
            wallet: pubkey.map(|nostr_pubkey_hex| ConnectWallet { nostr_pubkey_hex }),
        }
    }

    #[test]
    fn durable_object_session_id_is_strictly_validated() {
        assert!(valid_session_id(&"a1".repeat(32)));
        assert!(!valid_session_id("short"));
        assert!(!valid_session_id(&"zz".repeat(32)));
    }

    #[test]
    fn approved_result_returns_the_connect_nostr_key() {
        let keys = Keys::generate();
        let session_id = "a1".repeat(32);
        let pubkey = approved_connect_pubkey(
            result(
                "approved",
                "connect",
                &session_id,
                Some(keys.public_key().to_hex()),
            ),
            &session_id,
            ConnectFlow::Access,
        )
        .expect("approved key");
        assert_eq!(pubkey, keys.public_key());
    }

    #[test]
    fn pending_expired_and_malformed_results_fail_closed() {
        let session_id = "a1".repeat(32);
        assert_eq!(
            approved_connect_pubkey(
                result("pending", "connect", &session_id, None),
                &session_id,
                ConnectFlow::Access,
            ),
            Err(ConnectApprovalError::NotApproved)
        );
        assert_eq!(
            approved_connect_pubkey(
                result("expired", "connect", &session_id, None),
                &session_id,
                ConnectFlow::Access,
            ),
            Err(ConnectApprovalError::Expired)
        );
        assert_eq!(
            approved_connect_pubkey(
                result("approved", "connect", &session_id, None),
                &session_id,
                ConnectFlow::Access,
            ),
            Err(ConnectApprovalError::Invalid)
        );
        assert_eq!(
            approved_connect_pubkey(
                result("approved", "connect", &session_id, Some("zz".repeat(32)),),
                &session_id,
                ConnectFlow::Access,
            ),
            Err(ConnectApprovalError::Invalid)
        );
        assert_eq!(
            approved_connect_pubkey(
                result("approved", "create", &session_id, None),
                &session_id,
                ConnectFlow::Access,
            ),
            Err(ConnectApprovalError::Invalid)
        );
        assert_eq!(
            approved_connect_pubkey(
                result("approved", "connect", &"b2".repeat(32), None),
                &session_id,
                ConnectFlow::Access,
            ),
            Err(ConnectApprovalError::Invalid)
        );
    }
}
