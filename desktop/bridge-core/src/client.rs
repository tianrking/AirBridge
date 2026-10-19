// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
use crate::{
    protocol::{self, Lines, MAX_FILE},
    receiving::Receiver,
};
use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

pub type Events = Arc<dyn Fn(Value) + Send + Sync>;
pub struct Client {
    port: Box<dyn serialport::SerialPort>,
    receiver: Receiver,
    lines: Lines,
    session: String,
    sequence: u32,
    replies: BTreeMap<u32, Value>,
    completion: Option<Value>,
    resolution: Option<Value>,
    transfer_id: Option<String>,
    capabilities: Option<Value>,
    events: Events,
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
}
impl Client {
    pub fn open_selected(
        selection: crate::ports::BridgePort,
        directory: PathBuf,
        events: Events,
        stop: Arc<AtomicBool>,
        cancel: Arc<AtomicBool>,
    ) -> Result<Self> {
        crate::ports::validate_selection(&selection, &crate::ports::available()?)?;
        let mut port = serialport::new(&selection.port, 115200)
            .timeout(Duration::from_millis(50))
            .flow_control(serialport::FlowControl::None)
            .dtr_on_open(false)
            .open()?;
        port.write_request_to_send(false)?;
        port.write_data_terminal_ready(false)?;
        port.clear(serialport::ClearBuffer::Input)?;
        let receiver = Receiver::new(directory)?;
        let session = uuid::Uuid::new_v4().simple().to_string()[..16].to_owned();
        let mut client = Self {
            port,
            receiver,
            lines: Lines::default(),
            session,
            sequence: 0,
            replies: BTreeMap::new(),
            completion: None,
            resolution: None,
            transfer_id: None,
            capabilities: None,
            events,
            stop,
            cancel,
        };
        client.port.write_all(b"\n")?;
        let hello =
            client.request_body(format!("HELLO {}", client.session), Duration::from_secs(5))?;
        let max = hello["max_file"].as_u64().context("Missing file bound")?;
        let chunk = hello["chunk_bytes"]
            .as_u64()
            .context("Missing chunk bound")?;
        ensure!(
            hello["protocol"] == 2
                && max > 0
                && max <= MAX_FILE as u64
                && chunk > 0
                && chunk <= 112
                && protocol::mac(hello["radio_mac"].as_str().unwrap_or("")),
            "Unsupported bridge capabilities"
        );
        ensure!(
            hello["hardware_id"]
                .as_str()
                .is_some_and(|id| crate::ports::factory_identity(id)
                    && id.eq_ignore_ascii_case(&selection.usb_serial)),
            "Firmware factory identity does not match the selected USB device"
        );
        client.capabilities = Some(hello.clone());
        (client.events)(
            json!({"event":"connected","port":selection.port,"usb_serial":selection.usb_serial,"capabilities":hello}),
        );
        // Connecting USB must not start a network operation or delay queued
        // user commands. Resolve a currently advertised peer on selection.
        Ok(client)
    }
    fn request_body(&mut self, body: String, timeout: Duration) -> Result<Value> {
        self.sequence = self
            .sequence
            .checked_add(1)
            .context("Serial sequence exhausted; reconnect required")?;
        self.port
            .write_all(&protocol::command(self.sequence, &body)?)?;
        let end = Instant::now() + timeout;
        while Instant::now() < end {
            self.poll()?;
            if let Some(reply) = self.replies.remove(&self.sequence) {
                ensure!(
                    reply["ok"] == true,
                    "Bridge rejected command: {}",
                    reply["reason"]
                );
                return Ok(reply);
            }
        }
        bail!("Serial command timed out; outcome uncertain; no automatic resend")
    }
    pub fn pair(&mut self, peer: Option<&str>, port: u16) -> Result<()> {
        ensure!(
            self.capabilities
                .as_ref()
                .is_some_and(|caps| caps["pairing"] == true),
            "Update bridge firmware to enable session peer authorization"
        );
        let body = match peer {
            Some(id) => {
                ensure!(protocol::mac(id) && port > 0, "Invalid peer");
                format!("PAIR {id} {port}")
            }
            None => "UNPAIR".to_owned(),
        };
        let reply = self.request(&body)?;
        let expected = peer.unwrap_or("00:00:00:00:00:00");
        ensure!(
            reply["paired_peer"]
                .as_str()
                .is_some_and(|id| id.eq_ignore_ascii_case(expected)),
            "Peer authorization reply mismatch"
        );
        (self.events)(json!({"event":"pairing_updated","paired_peer":reply["paired_peer"]}));
        Ok(())
    }
    pub fn request(&mut self, body: &str) -> Result<Value> {
        self.request_body(format!("{} {body}", self.session), Duration::from_secs(5))
    }
    pub fn poll(&mut self) -> Result<()> {
        ensure!(
            !self.stop.load(Ordering::Relaxed),
            "Serial owner stopped; unfinished operation outcome uncertain"
        );
        if let Err(error) = self.receiver.check_timeout(Instant::now()) {
            if let Some(failure) = self.receiver.take_failure() {
                (self.events)(failure);
            }
            return Err(error);
        }
        let mut buffer = [0u8; 4096];
        let size = match self.port.read(&mut buffer) {
            Ok(count) => count,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::Interrupted
                ) =>
            {
                0
            }
            Err(error) => return Err(error.into()),
        };
        for line in self.lines.feed(&buffer[..size])? {
            let Ok(event) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            let Some(kind) = event["event"].as_str() else {
                continue;
            };
            match kind {
                "qualification_boot" if self.capabilities.is_some() => {
                    bail!("Bridge restarted during the serial session")
                }
                "command_invalid" if self.capabilities.is_some() => {
                    bail!("Bridge rejected command CRC or framing")
                }
                "command_reply" => {
                    let sequence = event["sequence"]
                        .as_u64()
                        .context("Invalid acknowledgement sequence")?;
                    ensure!(
                        sequence <= self.sequence as u64
                            && event["ok"].is_boolean()
                            && self.replies.len() < 16,
                        "Unexpected acknowledgement"
                    );
                    self.replies.insert(sequence as u32, event.clone());
                }
                "outgoing_complete" => {
                    ensure!(
                        event["transfer_id"].as_str() == self.transfer_id.as_deref(),
                        "Unexpected transfer completion"
                    );
                    // Native completion is held until send() checks the staged size and hash.
                    self.completion = Some(event.clone());
                }
                "outgoing_peer" | "peer_resolved" => {
                    let name = String::from_utf8(
                        STANDARD
                            .decode(event["name_b64"].as_str().context("Missing native name")?)?,
                    )?;
                    ensure!(name.len() <= 256, "Native name exceeds bound");
                    if kind == "peer_resolved" {
                        (self.events)(
                            json!({"event":"peer_identity","mac":event["mac"],"display_name":name,"name_source":"airdrop_discover","error":0,"http_status":200}),
                        );
                    } else {
                        (self.events)(
                            json!({"event":"peer_name","display_name":name,"name_source":"airdrop_discover"}),
                        );
                    }
                }
                "resolution_complete" => {
                    self.resolution = Some(event.clone());
                    (self.events)(event.clone());
                }
                "scanner_status" => {
                    (self.events)(json!({"event":"peers","peers":event["peers"]}));
                }
                "outgoing_progress" => {
                    validate_progress(&event)?;
                    (self.events)(event.clone());
                }
                "peer_identity" | "outgoing_stage" | "resolve_stage" => {
                    (self.events)(event.clone());
                }
                _ => {}
            }
            let handled = match self.receiver.handle(&event) {
                Ok(handled) => handled,
                Err(error) => {
                    if let Some(failure) = self.receiver.take_failure() {
                        (self.events)(failure);
                    }
                    return Err(error);
                }
            };
            if let Some(ack) = handled.acknowledgement {
                self.port.write_all(&ack)?;
            }
            if let Some(notification) = handled.event {
                (self.events)(notification);
            }
        }
        Ok(())
    }
    pub fn resolve(&mut self, peer: &str, port: u16) -> Result<()> {
        ensure!(
            self.capabilities.as_ref().is_some_and(|value| value["resolve"] == true),
            "This firmware resolves the configured device automatically; manual name queries need newer firmware"
        );
        ensure!(
            protocol::mac(peer) && port > 0,
            "Invalid recipient endpoint"
        );
        self.resolution = None;
        (self.events)(json!({"event":"resolution_started","mac":peer}));
        self.request(&format!("RESOLVE {peer} {port}"))?;
        let end = Instant::now() + Duration::from_secs(90);
        while Instant::now() < end {
            if let Some(result) = self.resolution.as_ref() {
                ensure!(
                    result["mac"] == peer && result["error"] == 0 && result["http_status"] == 200,
                    "The recipient did not answer its native name query (error {}, HTTP {})",
                    result["error"],
                    result["http_status"]
                );
                return Ok(());
            }
            self.poll()?;
        }
        bail!("Native device-name query timed out")
    }
    pub fn send(&mut self, path: &Path, peer: &str, port: u16) -> Result<()> {
        ensure!(
            protocol::mac(peer) && port > 0,
            "Invalid recipient endpoint"
        );
        ensure!(
            self.transfer_id.is_none() || self.completion.is_some(),
            "Previous native operation is unresolved"
        );
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .context("Filename is not UTF-8")?;
        ensure!(
            protocol::safe_name(name),
            "Source filename is not a safe Windows component"
        );
        let source = File::open(path)?;
        ensure!(source.metadata()?.is_file(), "Source is not a regular file");
        let mut data = Vec::new();
        source.take((MAX_FILE + 1) as u64).read_to_end(&mut data)?;
        ensure!(
            data.len() <= MAX_FILE,
            "File exceeds the current 1 MiB staging limit"
        );
        let hash = format!("{:x}", Sha256::digest(&data));
        let id = uuid::Uuid::new_v4().to_string().to_uppercase();
        let sender = self.capabilities.as_ref().unwrap()["radio_mac"]
            .as_str()
            .unwrap()
            .replace(':', "");
        let metadata = protocol::manifest(name, data.len(), &sender, &id)?;
        (self.events)(
            json!({"event":"outgoing_started","transfer_id":id,"name":name,"peer":peer,"bytes":data.len(),"sha256":hash}),
        );
        self.request(&format!(
            "BEGIN {} {} {hash} {peer} {port}",
            data.len(),
            metadata.len()
        ))?;
        for (verb, bytes) in [("META", metadata.as_slice()), ("DATA", data.as_slice())] {
            for (index, chunk) in bytes.chunks(112).enumerate() {
                if self.cancel.load(Ordering::Relaxed) {
                    self.request("CANCEL")?;
                    bail!("Source staging cancelled before native delivery");
                }
                let offset = index * 112;
                let reply = self.request(&format!("{verb} {offset} {}", STANDARD.encode(chunk)))?;
                ensure!(
                    reply["offset"].as_u64() == Some((offset + chunk.len()) as u64),
                    "Wrong staging acknowledgement offset"
                );
                if verb == "DATA"
                    && (offset == 0
                        || offset + chunk.len() == data.len()
                        || offset / 16384 != (offset + chunk.len()) / 16384)
                {
                    (self.events)(
                        json!({"event":"staging_progress","transfer_id":id,"bytes":offset+chunk.len(),"total_bytes":data.len()}),
                    );
                }
            }
        }
        self.transfer_id = Some(id.clone());
        self.completion = None;
        self.request("SEND")?;
        let end = Instant::now() + Duration::from_secs(420);
        let mut cancellation_requested = false;
        while Instant::now() < end {
            if self.cancel.load(Ordering::Relaxed) && !cancellation_requested {
                self.request("CANCEL")?;
                cancellation_requested = true;
                (self.events)(json!({"event":"cancellation_requested","transfer_id":id}));
            }
            if let Some(outcome) = self.completion.as_ref() {
                if outcome["success"] != true || outcome["http_status"] != 200 {
                    (self.events)(outcome.clone());
                    bail!("AirDrop did not complete (error {}, HTTP {}). The file was not automatically resent.", outcome["error"], outcome["http_status"]);
                }
                validate_success(outcome, data.len(), &hash)?;
                (self.events)(outcome.clone());
                return Ok(());
            }
            self.poll()?;
        }
        self.request("CANCEL")?;
        bail!("Native transfer timed out; cancellation requested; destination result uncertain")
    }
}

fn validate_progress(event: &Value) -> Result<()> {
    let done = event["wire_bytes"]
        .as_u64()
        .context("Invalid archive byte count")?;
    let total = event["wire_total"]
        .as_u64()
        .context("Invalid archive size")?;
    ensure!(
        done <= total && total <= 9_007_199_254_740_991,
        "Invalid archive progress"
    );
    Ok(())
}
// This gate runs before publishing a successful host event to the desktop UI.
fn validate_success(outcome: &Value, bytes: usize, hash: &str) -> Result<()> {
    ensure!(
        outcome["success"] == true
            && outcome["http_status"] == 200
            && outcome["bytes"].as_u64() == Some(bytes as u64)
            && outcome["sha256"] == hash,
        "Native completion differs from staged file"
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_wire_progress_before_publishing_it() {
        assert!(validate_progress(&json!({"wire_bytes":0,"wire_total":0})).is_ok());
        for event in [
            json!({"wire_bytes":-1,"wire_total":3}),
            json!({"wire_bytes":4,"wire_total":3}),
            json!({"wire_bytes":0.5,"wire_total":3}),
            json!({"wire_bytes":0,"wire_total":9007199254740992_u64}),
        ] {
            assert!(validate_progress(&event).is_err());
        }
    }
    #[test]
    fn native_success_is_not_publishable_with_a_different_source() {
        let hash = "a".repeat(64);
        let valid = json!({"success":true,"http_status":200,"bytes":4097,"sha256":hash});
        assert!(validate_success(&valid, 4097, &hash).is_ok());
        for (key, value) in [
            ("bytes", json!(4096)),
            ("sha256", json!("b".repeat(64))),
            ("http_status", json!(500)),
            ("success", json!(false)),
        ] {
            let mut invalid = valid.clone();
            invalid[key] = value;
            assert!(validate_success(&invalid, 4097, &hash).is_err());
        }
    }
}
