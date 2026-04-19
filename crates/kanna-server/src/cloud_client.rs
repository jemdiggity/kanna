use crate::config::Config;

#[derive(Debug, Clone, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreatePairingCodeResponse {
    pub pairing_code: String,
    pub pairing_code_id: String,
    pub desktop_id: String,
    pub desktop_secret: String,
    pub desktop_claim_token: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatePairingCodeRequest<'a> {
    desktop_display_name: &'a str,
}

pub async fn create_pairing_code(config: &Config) -> Result<CreatePairingCodeResponse, String> {
    let base_url = config.cloud_base_url.trim_end_matches('/');
    let url = format!("{base_url}/createPairingCode");
    let client = reqwest::Client::new();
    let mut request = client
        .post(url)
        .header("x-kanna-firebase-project-id", &config.firebase_project_id);

    if let Some(auth_emulator_url) = &config.firebase_auth_emulator_url {
        request = request.header("x-kanna-firebase-auth-emulator-url", auth_emulator_url);
    }

    if let Some(firestore_emulator_host) = &config.firebase_firestore_emulator_host {
        request = request.header("x-kanna-firestore-emulator-host", firestore_emulator_host);
    }

    let response = request
        .json(&CreatePairingCodeRequest {
            desktop_display_name: &config.desktop_name,
        })
        .send()
        .await
        .map_err(|err| format!("failed to call createPairingCode: {err}"))?;

    if !response.status().is_success() {
        return Err(format!("createPairingCode returned {}", response.status()));
    }

    response
        .json::<CreatePairingCodeResponse>()
        .await
        .map_err(|err| format!("failed to parse createPairingCode response: {err}"))
}

#[cfg(test)]
mod tests {
    use crate::config::Config;
    use axum::{extract::Json, routing::post, Router};
    use serde_json::Value;
    use std::net::SocketAddr;
    use std::path::PathBuf;

    #[test]
    fn create_pairing_code_response_deserializes_from_camel_case_payload() {
        let payload = serde_json::json!({
            "pairingCode": "ABC123",
            "pairingCodeId": "pairing-code-1",
            "desktopId": "desktop-1",
            "desktopSecret": "desktop-secret",
            "desktopClaimToken": "claim-token",
            "expiresAt": "2026-04-19T00:00:00Z"
        });

        let parsed: super::CreatePairingCodeResponse = serde_json::from_value(payload).unwrap();

        assert_eq!(parsed.pairing_code, "ABC123");
        assert_eq!(parsed.pairing_code_id, "pairing-code-1");
        assert_eq!(parsed.desktop_id, "desktop-1");
        assert_eq!(parsed.desktop_secret, "desktop-secret");
        assert_eq!(parsed.desktop_claim_token, "claim-token");
        assert_eq!(parsed.expires_at, "2026-04-19T00:00:00Z");
    }

    #[tokio::test]
    async fn create_pairing_code_posts_desktop_name_and_parses_response() {
        async fn handler(Json(payload): Json<Value>) -> Json<Value> {
            assert_eq!(
                payload,
                serde_json::json!({
                    "desktopDisplayName": "Studio Mac"
                })
            );

            Json(serde_json::json!({
                "pairingCode": "ABC123",
                "pairingCodeId": "pairing-code-1",
                "desktopId": "desktop-1",
                "desktopSecret": "desktop-secret",
                "desktopClaimToken": "claim-token",
                "expiresAt": "2026-04-19T00:05:00Z"
            }))
        }

        let app = Router::new().route("/createPairingCode", post(handler));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let config = Config {
            relay_url: "wss://relay.example".to_string(),
            device_token: "device-token".to_string(),
            cloud_base_url: format!("http://{addr}"),
            firebase_project_id: "kanna-local".to_string(),
            firebase_auth_emulator_url: Some("http://127.0.0.1:9099".to_string()),
            firebase_firestore_emulator_host: Some("127.0.0.1:8080".to_string()),
            daemon_dir: "/tmp/kanna-daemon".to_string(),
            db_path: "/tmp/kanna.db".to_string(),
            desktop_id: "desktop-1".to_string(),
            desktop_secret: None,
            desktop_name: "Studio Mac".to_string(),
            lan_host: "0.0.0.0".to_string(),
            lan_port: 48120,
            pairing_store_path: PathBuf::from("/tmp/kanna-pairings.json")
                .to_string_lossy()
                .to_string(),
        };

        let response = super::create_pairing_code(&config).await.unwrap();

        assert_eq!(response.pairing_code, "ABC123");
        assert_eq!(response.pairing_code_id, "pairing-code-1");
        assert_eq!(response.desktop_id, "desktop-1");
        assert_eq!(response.desktop_secret, "desktop-secret");
        assert_eq!(response.desktop_claim_token, "claim-token");
        assert_eq!(response.expires_at, "2026-04-19T00:05:00Z");

        server.abort();
    }
}
