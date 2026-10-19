// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    value.strip_prefix("\\\\?\\").unwrap_or(&value).to_owned()
}
#[derive(Clone, Serialize)]
pub struct SelectedFile {
    pub id: String,
    pub name: String,
    pub bytes: u64,
}
#[derive(Clone, Serialize)]
pub struct Peer {
    pub mac: String,
    pub name: Option<String>,
    pub name_source: Option<String>,
    pub advertised: bool,
    pub port: u16,
    pub rssi: Option<i64>,
    pub observation: Value,
    pub last_seen: u64,
}
#[derive(Clone, Serialize)]
pub struct Transfer {
    pub id: String,
    pub native_id: String,
    pub name: String,
    pub direction: String,
    pub peer: Option<String>,
    pub state: String,
    pub bytes: u64,
    pub done: u64,
    pub progress_total: u64,
    pub sha256: Option<String>,
    pub directory: Option<String>,
    pub error: Option<String>,
    pub updated: u64,
    pub started: u64,
    pub peer_name: Option<String>,
    pub file_count: usize,
    pub files: Vec<Value>,
    #[serde(skip)]
    pub parts: BTreeMap<String, u64>,
}
#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub revision: u64,
    pub resolving_peer: Option<String>,
    pub can_resolve: bool,
    pub connection: String,
    pub radio_mac: Option<String>,
    pub bridge_info: Option<Value>,
    pub peers: Vec<Peer>,
    pub transfers: Vec<Transfer>,
    pub receive_directory: String,
    pub error: Option<String>,
    #[serde(skip)]
    names: BTreeMap<String, String>,
}
impl Snapshot {
    pub fn new(receive_directory: String) -> Self {
        Self {
            revision: 0,
            resolving_peer: None,
            can_resolve: false,
            connection: "disconnected".into(),
            radio_mac: None,
            bridge_info: None,
            peers: Vec::new(),
            transfers: Vec::new(),
            receive_directory,
            error: None,
            names: BTreeMap::new(),
        }
    }
    fn outgoing(&mut self) -> Option<&mut Transfer> {
        self.transfers.iter_mut().find(|transfer| {
            transfer.direction == "send"
                && !matches!(
                    transfer.state.as_str(),
                    "completed" | "failed" | "cancelled" | "uncertain"
                )
        })
    }
    fn incoming(&mut self, id: &str) -> Option<&mut Transfer> {
        self.transfers.iter_mut().find(|transfer| {
            transfer.direction == "receive"
                && transfer.native_id == id
                && !matches!(
                    transfer.state.as_str(),
                    "completed" | "failed" | "cancelled" | "uncertain"
                )
        })
    }
    pub fn apply(&mut self, event: &Value) {
        self.revision += 1;
        let kind = event["event"].as_str().unwrap_or("");
        let time = now();
        match kind {
            "resolution_started" => {
                self.resolving_peer = event["mac"].as_str().map(str::to_owned);
            }
            "resolution_complete" => {
                self.resolving_peer = None;
            }
            "resolution_error" => {
                self.resolving_peer = None;
                self.error = event["message"].as_str().map(str::to_owned);
            }
            "connecting" => {
                self.connection = "connecting".into();
                self.error = None;
            }
            "connected" => {
                let caps = &event["capabilities"];
                self.bridge_info = Some(serde_json::json!({
                    "protocol":caps["protocol"], "max_file":caps["max_file"],
                    "chunk_bytes":caps["chunk_bytes"], "hardware_id":caps["hardware_id"],
                    "paired_peer":caps["paired_peer"], "usb_serial":event["usb_serial"],
                    "port":event["port"], "connected_at":time
                }));
                self.names.clear();
                self.peers.clear();
                self.can_resolve = event["capabilities"]["resolve"] == true;
                self.connection = "connected".into();
                self.error = None;
                self.radio_mac = event["capabilities"]["radio_mac"]
                    .as_str()
                    .map(str::to_owned);
            }
            "disconnected" => {
                self.resolving_peer = None;
                self.can_resolve = false;
                self.connection = "disconnected".into();
                self.peers.clear();
                for transfer in &mut self.transfers {
                    if !matches!(
                        transfer.state.as_str(),
                        "completed" | "failed" | "cancelled" | "uncertain"
                    ) {
                        transfer.updated = time;
                        transfer.state = "uncertain".into();
                        transfer.error = Some("Connection closed before native completion".into());
                    }
                }
            }
            "connection_error" => {
                self.connection = "error".into();
                self.error = event["message"].as_str().map(str::to_owned);
            }
            "peers" => {
                if let Some(peers) = event["peers"].as_array() {
                    self.peers = peers
                        .iter()
                        .filter_map(|peer| {
                            let mac = peer["mac"].as_str()?.to_owned();
                            let name = self.names.get(&mac).cloned();
                            let port = peer["airdrop_port"].as_u64().and_then(|v| u16::try_from(v).ok()).unwrap_or(0);
                            Some(Peer {
                                mac,
                                name_source: name.as_ref().map(|_| "airdrop_discover".into()),
                                name,
                                advertised: peer["airdrop_advertised"] == true && port > 0,
                                port,
                                rssi: peer["rssi"].as_i64().filter(|v| (-127..=0).contains(v)),
                                observation: serde_json::json!({
                                    "host_label":peer["host_label"], "service_instance":peer["service_instance"],
                                    "channel6_mask":peer["channel6_mask"], "root_metric":peer["root_metric"],
                                    "has_sync":peer["has_sync"], "has_election":peer["has_election"]
                                }),
                                last_seen: time,
                            })
                        })
                        .collect();
                }
            }
            "peer_identity" if event["error"] == 0 => {
                if let (Some(mac), Some(name)) = (
                    event["mac"].as_str(),
                    event["display_name"]
                        .as_str()
                        .filter(|name| !name.is_empty()),
                ) {
                    self.names.insert(mac.into(), name.into());
                    for t in &mut self.transfers {
                        if t.peer.as_deref() == Some(mac) {
                            t.peer_name = Some(name.into());
                        }
                    }
                    for peer in &mut self.peers {
                        if peer.mac == mac {
                            peer.name = Some(name.into());
                            peer.name_source = Some("airdrop_discover".into());
                        }
                    }
                }
            }
            "peer_name" => {
                let peer = self.outgoing().and_then(|transfer| transfer.peer.clone());
                if let (Some(mac), Some(name)) = (peer, event["display_name"].as_str()) {
                    self.names.insert(mac.clone(), name.into());
                    for t in &mut self.transfers {
                        if t.peer.as_deref() == Some(mac.as_str()) {
                            t.peer_name = Some(name.into());
                        }
                    }
                    for peer in &mut self.peers {
                        if peer.mac == mac {
                            peer.name = Some(name.into());
                            peer.name_source = Some("airdrop_discover".into());
                        }
                    }
                }
            }
            "outgoing_started" | "incoming_started" => {
                let send = kind == "outgoing_started";
                self.transfers.insert(
                    0,
                    Transfer {
                        id: if send {
                            event["transfer_id"].as_str().unwrap_or("").into()
                        } else {
                            uuid::Uuid::new_v4().to_string()
                        },
                        native_id: event["transfer_id"].as_str().unwrap_or("").into(),
                        name: event["name"].as_str().unwrap_or("Incoming files").into(),
                        direction: if send { "send" } else { "receive" }.into(),
                        peer: event["peer"].as_str().map(str::to_owned),
                        state: if send { "preparing" } else { "receiving" }.into(),
                        bytes: event["bytes"].as_u64().unwrap_or(0),
                        done: 0,
                        progress_total: event["bytes"].as_u64().unwrap_or(0),
                        sha256: event["sha256"].as_str().map(str::to_owned),
                        directory: event["directory"]
                            .as_str()
                            .map(|path| display_path(Path::new(path))),
                        error: None,
                        updated: time,
                        started: time,
                        peer_name: event["peer"]
                            .as_str()
                            .and_then(|mac| self.names.get(mac).cloned()),
                        file_count: if send {
                            1
                        } else {
                            event["files"].as_u64().unwrap_or(1) as usize
                        },
                        files: Vec::new(),
                        parts: BTreeMap::new(),
                    },
                );
                self.transfers.truncate(100);
            }
            "incoming_file" => {
                if let Some(transfer) = self.incoming(event["transfer_id"].as_str().unwrap_or("")) {
                    if transfer.file_count <= 1 {
                        transfer.name = event["name"].as_str().unwrap_or("Incoming files").into();
                    }
                    transfer.updated = time;
                }
            }
            "staging_progress" => {
                if let Some(transfer) = self.outgoing() {
                    transfer.updated = time;
                    transfer.done = event["bytes"].as_u64().unwrap_or(0);
                    transfer.progress_total =
                        event["total_bytes"].as_u64().unwrap_or(transfer.bytes);
                }
            }
            "outgoing_stage" => {
                if let Some(transfer) = self.outgoing() {
                    let cancelling = transfer.state == "cancelling";
                    transfer.state = match event["stage"].as_str().unwrap_or("") {
                        "awaiting_acceptance" => "waiting",
                        "accepted" | "uploading" => "sending",
                        _ => "connecting",
                    }
                    .into();
                    if cancelling {
                        transfer.state = "cancelling".into();
                    }
                    transfer.updated = time;
                    transfer.done = 0;
                    transfer.progress_total = 0;
                }
            }
            "outgoing_progress" => {
                if let Some(transfer) = self.outgoing() {
                    transfer.done = event["wire_bytes"].as_u64().unwrap_or(0);
                    transfer.progress_total = event["wire_total"].as_u64().unwrap_or(0);
                    transfer.updated = time;
                    if transfer.done == transfer.progress_total && transfer.state != "cancelling" {
                        transfer.state = "finishing".into();
                    }
                }
            }
            "incoming_progress" => {
                if let Some(transfer) = self.incoming(event["transfer_id"].as_str().unwrap_or("")) {
                    transfer.parts.insert(
                        event["name"].as_str().unwrap_or("").into(),
                        event["bytes"].as_u64().unwrap_or(0),
                    );
                    transfer.done = transfer.parts.values().sum();
                    transfer.updated = time;
                }
            }
            "outgoing_complete" => {
                if let Some(transfer) = self.transfers.iter_mut().find(|transfer| {
                    transfer.id == event["transfer_id"].as_str().unwrap_or("")
                        && !matches!(
                            transfer.state.as_str(),
                            "completed" | "failed" | "cancelled" | "uncertain"
                        )
                }) {
                    transfer.state = if event["success"] == true && event["http_status"] == 200 {
                        "completed"
                    } else if event["error"] == -125 {
                        "cancelled"
                    } else {
                        "failed"
                    }
                    .into();
                    transfer.updated = time;
                    if transfer.state == "completed" {
                        transfer.done = transfer.bytes;
                        transfer.progress_total = transfer.bytes;
                    } else {
                        transfer.error = Some(format!(
                            "Native error {}; HTTP {}",
                            event["error"], event["http_status"]
                        ));
                    }
                }
            }
            "incoming_failed" => {
                if let Some(transfer) = self.incoming(event["transfer_id"].as_str().unwrap_or("")) {
                    transfer.state = if event["uncertain"] == true {
                        "uncertain"
                    } else {
                        "failed"
                    }
                    .into();
                    transfer.error = Some(format!(
                        "{}: {}",
                        event["phase"].as_str().unwrap_or("receive"),
                        event["message"].as_str().unwrap_or("Receive failed")
                    ));
                    transfer.directory = event["directory"]
                        .as_str()
                        .map(|path| display_path(Path::new(path)));
                    transfer.updated = time;
                }
            }
            "incoming_verifying" => {
                if let Some(transfer) = self.incoming(event["transfer_id"].as_str().unwrap_or("")) {
                    transfer.state = "finishing".into();
                    transfer.updated = time;
                }
            }
            "received" => {
                if let Some(transfer) = self.incoming(event["transfer_id"].as_str().unwrap_or("")) {
                    transfer.state = "completed".into();
                    transfer.done = transfer.bytes;
                    transfer.progress_total = transfer.bytes;
                    transfer.updated = time;
                    transfer.directory = event["directory"]
                        .as_str()
                        .map(|path| display_path(Path::new(path)));
                    transfer.files = event["files"].as_array().cloned().unwrap_or_default();
                    transfer.file_count = transfer
                        .files
                        .iter()
                        .filter(|file| file["metadata"] == false)
                        .count();
                    transfer.sha256 = event["files"]
                        .as_array()
                        .and_then(|files| files.iter().find(|file| file["metadata"] == false))
                        .and_then(|file| file["sha256"].as_str())
                        .filter(|_| transfer.file_count == 1)
                        .map(str::to_owned);
                }
            }
            "operation_error" => {
                if let Some(transfer) = self.outgoing() {
                    transfer.state = "uncertain".into();
                    transfer.error = event["message"].as_str().map(str::to_owned);
                    transfer.updated = time;
                }
                self.error = event["message"].as_str().map(str::to_owned);
            }
            "cancellation_requested" => {
                if let Some(transfer) = self.outgoing() {
                    transfer.state = "cancelling".into();
                    transfer.updated = time;
                }
            }
            _ => {}
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn reused_receive_ids_keep_distinct_history_entries_and_paths() {
        let mut state = Snapshot::new("inbox".into());
        for directory in ["inbox/first", "inbox/second"] {
            state.apply(&json!({"event":"incoming_started","transfer_id":"REUSED","bytes":0}));
            state.apply(&json!({"event":"received","transfer_id":"REUSED","directory":directory,"files":[]}));
        }
        assert_ne!(state.transfers[0].id, state.transfers[1].id);
        assert_eq!(state.transfers[0].native_id, state.transfers[1].native_id);
        assert_ne!(state.transfers[0].directory, state.transfers[1].directory);
    }
    #[test]
    fn cancellation_and_terminal_history_are_stable_under_late_events() {
        let mut state = Snapshot::new("inbox".into());
        state.apply(&json!({"event":"outgoing_started","transfer_id":"SEND","bytes":3}));
        state.apply(&json!({"event":"cancellation_requested"}));
        state.apply(&json!({"event":"outgoing_stage","stage":"uploading"}));
        state.apply(&json!({"event":"outgoing_progress","wire_bytes":3,"wire_total":3}));
        assert_eq!(state.transfers[0].state, "cancelling");
        state.apply(&json!({"event":"outgoing_complete","transfer_id":"SEND","success":true,"http_status":200}));
        assert_eq!(state.transfers[0].state, "completed");
        state.apply(
            &json!({"event":"outgoing_complete","transfer_id":"SEND","success":false,"error":-125}),
        );
        assert_eq!(state.transfers[0].state, "completed");
        state.apply(&json!({"event":"incoming_started","transfer_id":"RECV","bytes":3}));
        state.apply(&json!({"event":"incoming_failed","transfer_id":"RECV","message":"Disk failure","phase":"file_end","uncertain":false}));
        state.apply(&json!({"event":"received","transfer_id":"RECV","files":[]}));
        assert_eq!(state.transfers[0].state, "failed");
        state.apply(&json!({"event":"disconnected"}));
        assert_eq!(state.transfers[0].state, "failed");
        assert!(!state.can_resolve);
    }
    #[test]
    fn provenance_and_missing_values_are_preserved() {
        let mut state = Snapshot::new("inbox".into());
        state.apply(&json!({"event":"connected","port":"COM4","usb_serial":"verified", "capabilities":{"protocol":2,"max_file":1048576,"chunk_bytes":112,"radio_mac":"02:11:22:33:44:55"}}));
        assert_eq!(state.bridge_info.as_ref().unwrap()["protocol"], 2);
        assert!(state.bridge_info.as_ref().unwrap()["hardware_id"].is_null());
        state.apply(&json!({"event":"peers","peers":[{"mac":"02:11:22:33:44:55","airdrop_advertised":true,"airdrop_port":8770,"root_metric":0,"has_sync":false}]}));
        assert!(state.peers[0].rssi.is_none());
        assert_eq!(state.peers[0].observation["root_metric"], 0);
        assert_eq!(state.peers[0].observation["has_sync"], false);
    }
    #[test]
    fn history_retains_names_and_all_verified_files() {
        let mut state = Snapshot::new("inbox".into());
        state.apply(&json!({"event":"peer_identity","mac":"02:11:22:33:44:55","error":0,"display_name":"Studio Mac"}));
        state.apply(&json!({"event":"outgoing_started","transfer_id":"SEND","peer":"02:11:22:33:44:55","bytes":3}));
        assert_eq!(state.transfers[0].peer_name.as_deref(), Some("Studio Mac"));
        state.transfers[0].updated = 1;
        state.apply(&json!({"event":"peers","peers":[]}));
        assert_eq!(state.transfers[0].updated, 1);
        state.apply(&json!({"event":"incoming_started","transfer_id":"RECV","files":2,"bytes":6}));
        state.apply(&json!({"event":"received","transfer_id":"RECV","directory":"inbox/RECV","files":[{"name":"one","bytes":3,"metadata":false,"sha256":"a"},{"name":"two","bytes":3,"metadata":false,"sha256":"b"},{"name":"._one","bytes":0,"metadata":true,"sha256":"c"}]}));
        assert_eq!(state.transfers[0].file_count, 2);
        assert_eq!(state.transfers[0].files.len(), 3);
        assert!(state.transfers[0].sha256.is_none());
    }
    #[test]
    fn source_and_wire_progress_do_not_fake_delivery() {
        let mut state = Snapshot::new("inbox".into());
        state.apply(
            &json!({"event":"outgoing_started","transfer_id":"TEST-1","name":"x.bin","bytes":3}),
        );
        state.apply(&json!({"event":"staging_progress","bytes":3,"total_bytes":3}));
        assert_eq!(state.transfers[0].state, "preparing");
        state.apply(&json!({"event":"outgoing_progress","wire_bytes":200,"wire_total":200}));
        assert_eq!(state.transfers[0].state, "finishing");
        state.apply(&json!({"event":"disconnected"}));
        assert_eq!(state.transfers[0].state, "uncertain");
    }
    #[test]
    fn native_name_is_distinct_from_host_label() {
        let mut state = Snapshot::new("inbox".into());
        state.apply(&json!({"event":"peers","peers":[{"mac":"02:11:22:33:44:55","host_label":"uuid","airdrop_advertised":true,"airdrop_port":8770}]}));
        assert!(state.peers[0].name.is_none());
        state.apply(&json!({"event":"peer_identity","error":0,"mac":"02:11:22:33:44:55","display_name":"真實裝置"}));
        assert_eq!(state.peers[0].name.as_deref(), Some("真實裝置"));
    }
}
