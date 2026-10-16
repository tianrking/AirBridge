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
    pub rssi: i64,
    pub last_seen: u64,
}
#[derive(Clone, Serialize)]
pub struct Transfer {
    pub id: String,
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
        self.transfers
            .iter_mut()
            .find(|transfer| transfer.direction == "receive" && transfer.id == id)
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
                self.can_resolve = event["capabilities"]["resolve"] == true;
                self.connection = "connected".into();
                self.error = None;
                self.radio_mac = event["capabilities"]["radio_mac"]
                    .as_str()
                    .map(str::to_owned);
            }
            "disconnected" => {
                self.resolving_peer = None;
                self.connection = "disconnected".into();
                self.peers.clear();
                for transfer in &mut self.transfers {
                    if !matches!(
                        transfer.state.as_str(),
                        "completed" | "failed" | "cancelled"
                    ) {
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
                            Some(Peer {
                                mac,
                                name_source: name.as_ref().map(|_| "airdrop_discover".into()),
                                name,
                                advertised: peer["airdrop_advertised"] == true,
                                port: peer["airdrop_port"].as_u64().unwrap_or(0) as u16,
                                rssi: peer["rssi"].as_i64().unwrap_or(-100),
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
                        id: event["transfer_id"].as_str().unwrap_or("").into(),
                        name: event["name"].as_str().unwrap_or("Incoming files").into(),
                        direction: if send { "send" } else { "receive" }.into(),
                        peer: event["peer"].as_str().map(str::to_owned),
                        state: if send { "preparing" } else { "receiving" }.into(),
                        bytes: event["bytes"].as_u64().unwrap_or(0),
                        done: 0,
                        progress_total: event["bytes"].as_u64().unwrap_or(0),
                        sha256: event["sha256"].as_str().map(str::to_owned),
                        directory: None,
                        error: None,
                        updated: time,
                        parts: BTreeMap::new(),
                    },
                );
                self.transfers.truncate(100);
            }
            "incoming_file" => {
                if let Some(transfer) = self.incoming(event["transfer_id"].as_str().unwrap_or("")) {
                    transfer.name = event["name"].as_str().unwrap_or("Incoming files").into();
                }
            }
            "staging_progress" => {
                if let Some(transfer) = self.outgoing() {
                    transfer.done = event["bytes"].as_u64().unwrap_or(0);
                    transfer.progress_total =
                        event["total_bytes"].as_u64().unwrap_or(transfer.bytes);
                }
            }
            "outgoing_stage" => {
                if let Some(transfer) = self.outgoing() {
                    transfer.state = match event["stage"].as_str().unwrap_or("") {
                        "awaiting_acceptance" => "waiting",
                        "accepted" | "uploading" => "sending",
                        _ => "connecting",
                    }
                    .into();
                    transfer.updated = time;
                    if transfer.state == "connecting" {
                        transfer.done = 0;
                        transfer.progress_total = 0;
                    }
                }
            }
            "outgoing_progress" => {
                if let Some(transfer) = self.outgoing() {
                    transfer.done = event["wire_bytes"].as_u64().unwrap_or(0);
                    transfer.progress_total = event["wire_total"].as_u64().unwrap_or(0);
                    transfer.updated = time;
                    if transfer.done == transfer.progress_total {
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
                if let Some(transfer) = self
                    .transfers
                    .iter_mut()
                    .find(|transfer| transfer.id == event["transfer_id"].as_str().unwrap_or(""))
                {
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
            "received" => {
                if let Some(transfer) = self.incoming(event["transfer_id"].as_str().unwrap_or("")) {
                    transfer.state = "completed".into();
                    transfer.done = transfer.bytes;
                    transfer.progress_total = transfer.bytes;
                    transfer.updated = time;
                    transfer.directory = event["directory"]
                        .as_str()
                        .map(|path| display_path(Path::new(path)));
                    transfer.sha256 = event["files"]
                        .as_array()
                        .and_then(|files| files.iter().find(|file| file["metadata"] == false))
                        .and_then(|file| file["sha256"].as_str())
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
