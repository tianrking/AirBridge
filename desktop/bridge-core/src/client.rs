// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
use crate::{
    protocol::{self, Lines, MAX_FILE, PORT, USB_SERIAL},
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
    pub fn open(
        directory: PathBuf,
        events: Events,
        stop: Arc<AtomicBool>,
        cancel: Arc<AtomicBool>,
    ) -> Result<Self> {
        let ports = serialport::available_ports()?;
        let matched=ports.iter().filter(|port|port.port_name==PORT && matches!(&port.port_type,serialport::SerialPortType::UsbPort(info) if info.serial_number.as_deref()==Some(USB_SERIAL))).count();
        ensure!(
            matched == 1,
            "Authorized replacement COM4 USB identity is absent"
        );
        let mut port = serialport::new(PORT, 115200)
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
        client.capabilities = Some(hello.clone());
        (client.events)(
            json!({"event":"connected","port":PORT,"usb_serial":USB_SERIAL,"capabilities":hello}),
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
    pub fn request(&mut self, body: &str) -> Result<Value> {
        self.request_body(format!("{} {body}", self.session), Duration::from_secs(5))
    }
    pub fn poll(&mut self) -> Result<()> {
        ensure!(
            !self.stop.load(Ordering::Relaxed),
            "Serial owner stopped; unfinished operation outcome uncertain"
        );
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
                    self.completion = Some(event.clone());
                    (self.events)(event.clone());
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
                "peer_identity" | "outgoing_stage" | "outgoing_progress" | "resolve_stage" => {
                    (self.events)(event.clone());
                }
                _ => {}
            }
            let handled = self.receiver.handle(&event)?;
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
                ensure!(
                    outcome["success"] == true && outcome["http_status"] == 200,
                    "AirDrop did not complete (error {}, HTTP {}). The file was not automatically resent.",
                    outcome["error"], outcome["http_status"]
                );
                ensure!(
                    outcome["bytes"].as_u64() == Some(data.len() as u64)
                        && outcome["sha256"] == hash,
                    "Native completion differs from staged file"
                );
                return Ok(());
            }
            self.poll()?;
        }
        self.request("CANCEL")?;
        bail!("Native transfer timed out; cancellation requested; destination result uncertain")
    }
}
