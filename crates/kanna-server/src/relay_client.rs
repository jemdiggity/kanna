use crate::config::Config;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

pub type WsSink = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;
pub type WsStream = SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RelayMessage {
    #[serde(rename = "auth")]
    Auth {
        #[serde(skip_serializing_if = "Option::is_none")]
        device_token: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        desktop_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        desktop_secret: Option<String>,
    },
    #[serde(rename = "invoke")]
    Invoke {
        id: u64,
        command: String,
        args: serde_json::Value,
    },
    #[serde(rename = "response")]
    Response {
        id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    #[serde(rename = "event")]
    Event {
        name: String,
        payload: serde_json::Value,
    },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "auth_ok")]
    AuthOk {
        #[serde(rename = "userId")]
        user_id: String,
    },
}

fn build_auth_message(config: &Config) -> RelayMessage {
    match &config.desktop_secret {
        Some(desktop_secret) => RelayMessage::Auth {
            device_token: None,
            desktop_id: Some(config.desktop_id.clone()),
            desktop_secret: Some(desktop_secret.clone()),
        },
        None => RelayMessage::Auth {
            device_token: Some(config.device_token.clone()),
            desktop_id: None,
            desktop_secret: None,
        },
    }
}

pub async fn connect_to_relay(
    config: &Config,
) -> Result<(WsSink, WsStream), Box<dyn std::error::Error>> {
    let (ws_stream, _response) = connect_async(&config.relay_url).await?;
    let (mut sink, stream) = ws_stream.split();

    // Send auth message immediately after connecting
    let auth = build_auth_message(config);
    let auth_json = serde_json::to_string(&auth)?;
    sink.send(Message::Text(auth_json.into())).await?;

    log::info!("Authenticated with relay");

    Ok((sink, stream))
}

#[cfg(test)]
mod tests {
    use crate::config::Config;

    fn test_config() -> Config {
        Config {
            relay_url: "ws://127.0.0.1:9080".to_string(),
            device_token: "device-token".to_string(),
            cloud_base_url: "http://127.0.0.1:5001/kanna-local/us-central1".to_string(),
            firebase_project_id: "kanna-local".to_string(),
            firebase_auth_emulator_url: Some("http://127.0.0.1:9099".to_string()),
            firebase_firestore_emulator_host: Some("127.0.0.1:8080".to_string()),
            daemon_dir: "/tmp/kanna-daemon".to_string(),
            db_path: "/tmp/kanna.db".to_string(),
            desktop_id: "desktop-1".to_string(),
            desktop_secret: None,
            desktop_name: "Studio Mac".to_string(),
            lan_host: "127.0.0.1".to_string(),
            lan_port: 48120,
            pairing_store_path: "/tmp/kanna-pairings.json".to_string(),
        }
    }

    #[test]
    fn build_auth_message_uses_legacy_device_token_when_desktop_secret_is_missing() {
        let auth = super::build_auth_message(&test_config());
        let payload = serde_json::to_value(auth).unwrap();

        assert_eq!(
            payload,
            serde_json::json!({
                "type": "auth",
                "device_token": "device-token"
            })
        );
    }

    #[test]
    fn build_auth_message_prefers_desktop_credentials_when_available() {
        let mut config = test_config();
        config.desktop_secret = Some("desktop-secret".to_string());

        let auth = super::build_auth_message(&config);
        let payload = serde_json::to_value(auth).unwrap();

        assert_eq!(
            payload,
            serde_json::json!({
                "type": "auth",
                "desktop_id": "desktop-1",
                "desktop_secret": "desktop-secret"
            })
        );
    }
}
