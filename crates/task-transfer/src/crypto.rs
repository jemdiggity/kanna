use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use thiserror::Error;
use x25519_dalek::{PublicKey, StaticSecret};

const ENVELOPE_VERSION: u32 = 1;
const ENCRYPTION_CONTEXT: &[u8] = b"kanna-task-transfer:sealed-json:v1";
const KEY_DERIVATION_SALT: &[u8] = b"kanna-task-transfer:key-derivation:v1";

pub struct TransferIdentity {
    secret: StaticSecret,
    pub public_key: PublicKey,
}

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("base64 error: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("unsupported sealed payload version: {0}")]
    UnsupportedVersion(u32),
    #[error("invalid nonce length: expected 24 bytes, got {0}")]
    InvalidNonceLength(usize),
    #[error("invalid ciphertext length: {0}")]
    InvalidCiphertextLength(usize),
    #[error("invalid public key length: expected 32 bytes, got {0}")]
    InvalidPublicKeyLength(usize),
    #[error("shared key derivation failed")]
    KeyDerivation,
    #[error("payload encryption failed")]
    Encrypt,
    #[error("payload decryption failed")]
    Decrypt,
}

#[derive(Debug, Serialize, Deserialize)]
struct SealedJsonEnvelope {
    version: u32,
    ephemeral_public_key: String,
    nonce_b64: String,
    ciphertext_b64: String,
}

impl TransferIdentity {
    pub fn generate() -> Self {
        let secret = generate_secret();
        let public_key = PublicKey::from(&secret);
        Self { secret, public_key }
    }
}

pub fn public_key_to_string(public_key: &PublicKey) -> String {
    URL_SAFE_NO_PAD.encode(public_key.as_bytes())
}

pub fn parse_public_key(encoded: &str) -> Result<PublicKey, CryptoError> {
    let public_key_bytes = URL_SAFE_NO_PAD.decode(encoded)?;
    let public_key_array: [u8; 32] = public_key_bytes
        .try_into()
        .map_err(|bytes: Vec<u8>| CryptoError::InvalidPublicKeyLength(bytes.len()))?;
    Ok(PublicKey::from(public_key_array))
}

pub fn seal_json(
    sender: &TransferIdentity,
    receiver_public: &PublicKey,
    payload: &Value,
) -> Result<String, CryptoError> {
    let ephemeral_secret = generate_secret();
    let ephemeral_public_key = PublicKey::from(&ephemeral_secret);
    let cipher = build_cipher(
        ephemeral_secret.diffie_hellman(receiver_public).as_bytes(),
        sender.secret.diffie_hellman(receiver_public).as_bytes(),
        &sender.public_key,
        receiver_public,
        &ephemeral_public_key,
    )?;
    let plaintext = serde_json::to_vec(payload)?;
    let mut nonce_bytes = [0u8; 24];
    OsRng.fill_bytes(&mut nonce_bytes);
    let aad = associated_data(&sender.public_key, receiver_public, &ephemeral_public_key);

    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext.as_ref(),
                aad: aad.as_slice(),
            },
        )
        .map_err(|_| CryptoError::Encrypt)?;

    let envelope = SealedJsonEnvelope {
        version: ENVELOPE_VERSION,
        ephemeral_public_key: public_key_to_string(&ephemeral_public_key),
        nonce_b64: STANDARD.encode(nonce_bytes),
        ciphertext_b64: STANDARD.encode(ciphertext),
    };

    serde_json::to_string(&envelope).map_err(CryptoError::from)
}

pub fn open_json(
    receiver: &TransferIdentity,
    sender_public: &PublicKey,
    sealed: &str,
) -> Result<Value, CryptoError> {
    let envelope: SealedJsonEnvelope = serde_json::from_str(sealed)?;
    if envelope.version != ENVELOPE_VERSION {
        return Err(CryptoError::UnsupportedVersion(envelope.version));
    }

    let ephemeral_public_key = parse_public_key(&envelope.ephemeral_public_key)?;

    let nonce_bytes = STANDARD.decode(envelope.nonce_b64)?;
    if nonce_bytes.len() != 24 {
        return Err(CryptoError::InvalidNonceLength(nonce_bytes.len()));
    }

    let ciphertext = STANDARD.decode(envelope.ciphertext_b64)?;
    if ciphertext.is_empty() {
        return Err(CryptoError::InvalidCiphertextLength(ciphertext.len()));
    }

    let cipher = build_cipher(
        receiver
            .secret
            .diffie_hellman(&ephemeral_public_key)
            .as_bytes(),
        receiver.secret.diffie_hellman(sender_public).as_bytes(),
        sender_public,
        &receiver.public_key,
        &ephemeral_public_key,
    )?;
    let aad = associated_data(sender_public, &receiver.public_key, &ephemeral_public_key);

    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(nonce_bytes.as_slice()),
            Payload {
                msg: ciphertext.as_ref(),
                aad: aad.as_slice(),
            },
        )
        .map_err(|_| CryptoError::Decrypt)?;

    serde_json::from_slice(&plaintext).map_err(CryptoError::from)
}

fn build_cipher(
    ephemeral_shared_secret: &[u8],
    static_shared_secret: &[u8],
    sender_public: &PublicKey,
    receiver_public: &PublicKey,
    ephemeral_public_key: &PublicKey,
) -> Result<XChaCha20Poly1305, CryptoError> {
    let mut input_key_material =
        Vec::with_capacity(ephemeral_shared_secret.len() + static_shared_secret.len());
    input_key_material.extend_from_slice(ephemeral_shared_secret);
    input_key_material.extend_from_slice(static_shared_secret);
    let hkdf = Hkdf::<Sha256>::new(Some(KEY_DERIVATION_SALT), input_key_material.as_slice());
    let mut key = [0u8; 32];
    hkdf.expand(
        associated_data(sender_public, receiver_public, ephemeral_public_key).as_slice(),
        &mut key,
    )
    .map_err(|_| CryptoError::KeyDerivation)?;
    Ok(XChaCha20Poly1305::new((&key).into()))
}

fn associated_data(
    sender_public: &PublicKey,
    receiver_public: &PublicKey,
    ephemeral_public_key: &PublicKey,
) -> Vec<u8> {
    let mut aad = Vec::with_capacity(
        ENCRYPTION_CONTEXT.len()
            + sender_public.as_bytes().len()
            + receiver_public.as_bytes().len()
            + ephemeral_public_key.as_bytes().len(),
    );
    aad.extend_from_slice(ENCRYPTION_CONTEXT);
    aad.extend_from_slice(sender_public.as_bytes());
    aad.extend_from_slice(receiver_public.as_bytes());
    aad.extend_from_slice(ephemeral_public_key.as_bytes());
    aad
}

fn generate_secret() -> StaticSecret {
    let mut secret_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut secret_bytes);
    StaticSecret::from(secret_bytes)
}
