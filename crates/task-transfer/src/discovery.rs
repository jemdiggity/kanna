use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

const PEER_ID_KEY: &str = "peer_id";
const DISPLAY_NAME_KEY: &str = "display_name";
const PROTOCOL_VERSION_KEY: &str = "protocol_version";
const ACCEPTING_TRANSFERS_KEY: &str = "accepting_transfers";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TxtPeerRecord {
    pub peer_id: String,
    pub display_name: String,
    pub protocol_version: u32,
    pub accepting_transfers: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DiscoveryError {
    #[error("missing TXT field: {0}")]
    MissingField(&'static str),
    #[error("invalid peer_id")]
    InvalidPeerId,
    #[error("invalid display_name")]
    InvalidDisplayName,
    #[error("invalid protocol_version: {0}")]
    InvalidProtocolVersion(String),
    #[error("invalid accepting_transfers flag: {0}")]
    InvalidAcceptingTransfers(String),
    #[error("TXT entry for {field} exceeds 255 bytes: {length}")]
    TxtEntryTooLong { field: String, length: usize },
}

pub fn encode_txt_record(
    peer_id: &str,
    display_name: &str,
    protocol_version: u32,
    accepting_transfers: bool,
) -> Result<BTreeMap<String, String>, DiscoveryError> {
    validate_peer_id(peer_id)?;
    validate_display_name(display_name)?;
    validate_protocol_version(protocol_version)?;

    let txt = BTreeMap::from([
        (PEER_ID_KEY.to_owned(), peer_id.to_owned()),
        (DISPLAY_NAME_KEY.to_owned(), display_name.to_owned()),
        (
            PROTOCOL_VERSION_KEY.to_owned(),
            protocol_version.to_string(),
        ),
        (
            ACCEPTING_TRANSFERS_KEY.to_owned(),
            if accepting_transfers { "1" } else { "0" }.to_owned(),
        ),
    ]);

    validate_txt_entries(&txt)?;

    Ok(txt)
}

pub fn decode_txt_record(txt: &BTreeMap<String, String>) -> Result<TxtPeerRecord, DiscoveryError> {
    validate_txt_entries(txt)?;

    let peer_id = txt
        .get(PEER_ID_KEY)
        .cloned()
        .ok_or(DiscoveryError::MissingField(PEER_ID_KEY))?;
    validate_peer_id(&peer_id)?;

    let display_name = txt
        .get(DISPLAY_NAME_KEY)
        .cloned()
        .ok_or(DiscoveryError::MissingField(DISPLAY_NAME_KEY))?;
    validate_display_name(&display_name)?;

    let protocol_version = txt
        .get(PROTOCOL_VERSION_KEY)
        .ok_or(DiscoveryError::MissingField(PROTOCOL_VERSION_KEY))?
        .parse::<u32>()
        .map_err(|error| DiscoveryError::InvalidProtocolVersion(error.to_string()))?;
    validate_protocol_version(protocol_version)?;

    let accepting_transfers = match txt
        .get(ACCEPTING_TRANSFERS_KEY)
        .ok_or(DiscoveryError::MissingField(ACCEPTING_TRANSFERS_KEY))?
        .as_str()
    {
        "1" => true,
        "0" => false,
        other => return Err(DiscoveryError::InvalidAcceptingTransfers(other.to_owned())),
    };

    Ok(TxtPeerRecord {
        peer_id,
        display_name,
        protocol_version,
        accepting_transfers,
    })
}

pub(crate) fn validate_peer_id(peer_id: &str) -> Result<(), DiscoveryError> {
    if peer_id.is_empty() {
        return Err(DiscoveryError::InvalidPeerId);
    }

    if !peer_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(DiscoveryError::InvalidPeerId);
    }

    Ok(())
}

fn validate_display_name(display_name: &str) -> Result<(), DiscoveryError> {
    if display_name.trim().is_empty() || display_name.chars().any(char::is_control) {
        return Err(DiscoveryError::InvalidDisplayName);
    }

    Ok(())
}

fn validate_protocol_version(protocol_version: u32) -> Result<(), DiscoveryError> {
    if protocol_version == 0 {
        return Err(DiscoveryError::InvalidProtocolVersion(
            protocol_version.to_string(),
        ));
    }

    Ok(())
}

fn validate_txt_entries(txt: &BTreeMap<String, String>) -> Result<(), DiscoveryError> {
    for (key, value) in txt {
        let entry_length = key.len() + 1 + value.len();
        if entry_length > 255 {
            return Err(DiscoveryError::TxtEntryTooLong {
                field: key.clone(),
                length: entry_length,
            });
        }
    }

    Ok(())
}
