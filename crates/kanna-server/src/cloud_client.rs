use crate::config::Config;

#[derive(Debug, Clone, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreatePairingCodeResponse {
    pub pairing_code: String,
    pub pairing_code_id: String,
    pub desktop_id: String,
    pub desktop_claim_token: String,
    pub expires_at: String,
}

#[allow(dead_code)]
pub async fn create_pairing_code(_config: &Config) -> Result<CreatePairingCodeResponse, String> {
    Err("not implemented".to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn create_pairing_code_response_deserializes_from_camel_case_payload() {
        let payload = serde_json::json!({
            "pairingCode": "ABC123",
            "pairingCodeId": "pairing-code-1",
            "desktopId": "desktop-1",
            "desktopClaimToken": "claim-token",
            "expiresAt": "2026-04-19T00:00:00Z"
        });

        let parsed: super::CreatePairingCodeResponse = serde_json::from_value(payload).unwrap();

        assert_eq!(parsed.pairing_code, "ABC123");
        assert_eq!(parsed.pairing_code_id, "pairing-code-1");
        assert_eq!(parsed.desktop_id, "desktop-1");
        assert_eq!(parsed.desktop_claim_token, "claim-token");
        assert_eq!(parsed.expires_at, "2026-04-19T00:00:00Z");
    }
}
