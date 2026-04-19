use kanna_task_transfer::discovery::{
    encode_txt_record, service_info_to_peer_entry, DiscoveryError,
};
use mdns_sd::ServiceInfo;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[test]
fn resolved_service_maps_txt_metadata_and_prefers_ipv4_endpoints() {
    let txt = encode_txt_record("peer-alpha", "Primary", "pubkey-alpha", 1, true).unwrap();
    let properties = txt.into_iter().collect::<Vec<_>>();
    let info = ServiceInfo::new(
        "_kanna-xfer._tcp.local.",
        "peer-alpha",
        "peer-alpha.local.",
        &[
            IpAddr::V6(Ipv6Addr::LOCALHOST),
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 77)),
        ][..],
        4455,
        &properties[..],
    )
    .unwrap();

    let peer = service_info_to_peer_entry(&info).unwrap();
    assert_eq!(peer.peer_id, "peer-alpha");
    assert_eq!(peer.display_name, "Primary");
    assert_eq!(peer.public_key, "pubkey-alpha");
    assert_eq!(peer.protocol_version, 1);
    assert!(peer.accepting_transfers);
    assert_eq!(peer.endpoint, "192.168.1.77:4455");
}

#[test]
fn resolved_service_requires_txt_metadata_and_an_address() {
    let info = ServiceInfo::new(
        "_kanna-xfer._tcp.local.",
        "peer-alpha",
        "peer-alpha.local.",
        "",
        4455,
        &[("peer_id", "peer-alpha")][..],
    )
    .unwrap();

    let error = service_info_to_peer_entry(&info).unwrap_err();
    assert_eq!(error, DiscoveryError::MissingField("display_name"));
}
