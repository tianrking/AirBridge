// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
use crate::protocol::{digest, identity, safe_name};
use anyhow::{anyhow, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
    time::{Duration, Instant},
};

fn number(event: &Value, key: &str) -> Result<u64> {
    event[key].as_u64().ok_or_else(|| anyhow!("Invalid {key}"))
}
fn text<'a>(event: &'a Value, key: &str) -> Result<&'a str> {
    event[key].as_str().ok_or_else(|| anyhow!("Invalid {key}"))
}
fn decoded_name(event: &Value) -> Result<String> {
    let name = String::from_utf8(STANDARD.decode(text(event, "name_b64")?)?)?;
    ensure!(safe_name(&name), "Unsafe incoming filename");
    Ok(name)
}
struct Offer {
    name: String,
    size: u64,
}
struct IncomingFile {
    name: String,
    size: u64,
    offset: u64,
    hash: Sha256,
    stream: Option<File>,
    metadata: bool,
    sha256: Option<String>,
}
struct Job {
    id: String,
    count: usize,
    total: u64,
    temporary: PathBuf,
    offers: BTreeMap<usize, Offer>,
    files: BTreeMap<usize, IncomingFile>,
    names: BTreeSet<String>,
    published: Option<PathBuf>,
    complete: bool,
    failed: bool,
    progress_at: Instant,
}
#[derive(Default)]
pub struct Handled {
    pub acknowledgement: Option<Vec<u8>>,
    pub event: Option<Value>,
}
pub struct Receiver {
    directory: PathBuf,
    job: Option<Job>,
    failure: Option<Value>,
}
impl Receiver {
    pub fn new(directory: PathBuf) -> Result<Self> {
        fs::create_dir_all(&directory)?;
        Ok(Self {
            directory: fs::canonicalize(directory)?,
            job: None,
            failure: None,
        })
    }
    pub fn check_timeout(&mut self, now: Instant) -> Result<()> {
        if let Some(job) = self.job.as_mut().filter(|job| {
            !job.complete
                && !job.failed
                && now.saturating_duration_since(job.progress_at) >= Duration::from_secs(60)
        }) {
            job.failed = true;
            for file in job.files.values_mut() {
                file.stream.take();
            }
            self.failure = Some(
                json!({"event":"incoming_failed","transfer_id":job.id,"phase":"receive_timeout","message":"Receive progress timed out; completion unconfirmed","uncertain":true,"directory":job.published.as_ref().unwrap_or(&job.temporary)}),
            );
            anyhow::bail!("Receive progress timed out; completion unconfirmed");
        }
        Ok(())
    }
    pub fn take_failure(&mut self) -> Option<Value> {
        self.failure.take()
    }
    pub fn handle(&mut self, event: &Value) -> Result<Handled> {
        let kind = event["event"].as_str().unwrap_or("");
        if !matches!(
            kind,
            "transfer_begin"
                | "manifest_file"
                | "file_begin"
                | "file_chunk"
                | "file_end"
                | "transfer_ready"
                | "transfer_complete"
        ) {
            return Ok(Handled::default());
        }
        ensure!(
            !self.job.as_ref().is_some_and(|job| job.failed),
            "Receive job already failed"
        );
        let result = (|| {
            if kind != "transfer_begin" {
                if let Some(id) = event.get("transfer_id") {
                    ensure!(
                        self.job
                            .as_ref()
                            .is_some_and(|job| id.as_str() == Some(job.id.as_str())),
                        "Incoming transfer identity mismatch"
                    );
                }
            }
            self.process(event)
        })();
        if let Err(error) = &result {
            if let Some(job) = self.job.as_mut().filter(|job| !job.complete && !job.failed) {
                job.failed = true;
                for file in job.files.values_mut() {
                    file.stream.take();
                }
                self.failure = Some(
                    json!({"event":"incoming_failed","transfer_id":job.id,"phase":kind,"message":format!("{error:#}"),"uncertain":job.published.is_some(),"directory":job.published.as_ref().unwrap_or(&job.temporary)}),
                );
            }
        }
        if result.is_ok() {
            if let Some(job) = &mut self.job {
                job.progress_at = Instant::now();
            }
        }
        result
    }
    fn process(&mut self, event: &Value) -> Result<Handled> {
        let mut output = Handled::default();
        match event["event"].as_str().unwrap_or("") {
            "transfer_begin" => {
                ensure!(
                    self.job.as_ref().is_none_or(|job| job.complete),
                    "Previous transfer is unresolved"
                );
                let id = text(event, "transfer_id")?;
                let count = number(event, "files")? as usize;
                let total = number(event, "total_bytes")?;
                ensure!(
                    identity(id, 64) && (1..=16).contains(&count) && total <= 64 * 1024 * 1024,
                    "Incoming offer exceeds bounds"
                );
                let temporary = self
                    .directory
                    .join(format!("{id}.{}.partial", uuid::Uuid::new_v4().simple()));
                fs::create_dir(&temporary)?;
                self.job = Some(Job {
                    id: id.into(),
                    count,
                    total,
                    temporary,
                    offers: BTreeMap::new(),
                    files: BTreeMap::new(),
                    names: BTreeSet::new(),
                    published: None,
                    complete: false,
                    failed: false,
                    progress_at: Instant::now(),
                });
                output.event = Some(
                    json!({"event":"incoming_started","transfer_id":id,"files":count,"bytes":total,"directory":self.job.as_ref().unwrap().temporary}),
                );
            }
            "manifest_file" => {
                let job = self.job.as_mut().context("Manifest without transfer")?;
                let index = number(event, "index")? as usize;
                let size = number(event, "size")?;
                let name = decoded_name(event)?;
                ensure!(
                    job.published.is_none()
                        && job.files.is_empty()
                        && index < job.count
                        && !job.offers.contains_key(&index)
                        && size <= job.total,
                    "Invalid manifest index or size"
                );
                ensure!(
                    !job.offers
                        .values()
                        .any(|offer| offer.name.to_lowercase() == name.to_lowercase()),
                    "Duplicate manifest filename"
                );
                job.offers.insert(
                    index,
                    Offer {
                        name: name.clone(),
                        size,
                    },
                );
                output.event = Some(
                    json!({"event":"incoming_file","transfer_id":job.id,"name":name,"bytes":size}),
                );
            }
            "file_begin" => {
                let job = self.job.as_mut().context("File without transfer")?;
                ensure!(
                    job.published.is_none()
                        && job.offers.len() == job.count
                        && job.offers.values().map(|offer| offer.size).sum::<u64>() == job.total,
                    "Incomplete manifest"
                );
                let index = number(event, "index")? as usize;
                let metadata = event["metadata"]
                    .as_bool()
                    .context("Invalid metadata flag")?;
                ensure!(
                    index < 32 && (!metadata || index >= 16),
                    "Invalid file index"
                );
                let offer = job
                    .offers
                    .get(&(if metadata { index - 16 } else { index }))
                    .context("File not offered")?;
                let name = decoded_name(event)?;
                let size = number(event, "size")?;
                let expected = if metadata {
                    format!("._{}", offer.name)
                } else {
                    offer.name.clone()
                };
                ensure!(
                    name == expected
                        && (metadata || size == offer.size)
                        && size
                            <= if metadata {
                                128 * 1024
                            } else {
                                64 * 1024 * 1024
                            }
                        && !job.files.contains_key(&index)
                        && job.names.insert(name.to_lowercase()),
                    "Incoming file differs from offer"
                );
                let stream = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(job.temporary.join(&name))?;
                job.files.insert(
                    index,
                    IncomingFile {
                        name,
                        size,
                        offset: 0,
                        hash: Sha256::new(),
                        stream: Some(stream),
                        metadata,
                        sha256: None,
                    },
                );
            }
            "file_chunk" => {
                let job = self.job.as_mut().context("Chunk without transfer")?;
                ensure!(job.published.is_none(), "Chunk after publication");
                let index = number(event, "index")? as usize;
                let file = job
                    .files
                    .get_mut(&index)
                    .context("Chunk for unopened file")?;
                let data = STANDARD.decode(text(event, "data")?)?;
                ensure!(
                    file.sha256.is_none()
                        && number(event, "offset")? == file.offset
                        && !data.is_empty()
                        && data.len() <= 512
                        && data.len() as u64 <= file.size - file.offset,
                    "Chunk offset or length mismatch"
                );
                file.stream
                    .as_mut()
                    .context("Closed file")?
                    .write_all(&data)?;
                file.hash.update(&data);
                file.offset += data.len() as u64;
                output.acknowledgement =
                    Some(format!("CHUNK {} {index} {}\n", job.id, file.offset).into_bytes());
                if !file.metadata
                    && (file.offset == file.size || file.offset % 16384 < data.len() as u64)
                {
                    output.event = Some(
                        json!({"event":"incoming_progress","transfer_id":job.id,"name":file.name,"bytes":file.offset,"total_bytes":file.size}),
                    );
                }
            }
            "file_end" => {
                let job = self.job.as_mut().context("File end without transfer")?;
                ensure!(job.published.is_none(), "File end after publication");
                let file = job
                    .files
                    .get_mut(&(number(event, "index")? as usize))
                    .context("End for unopened file")?;
                let hash = format!("{:x}", file.hash.clone().finalize());
                ensure!(
                    file.sha256.is_none()
                        && file.offset == file.size
                        && number(event, "bytes")? == file.size
                        && digest(text(event, "sha256")?)
                        && hash == text(event, "sha256")?,
                    "Incoming SHA256 or size mismatch"
                );
                let mut stream = file.stream.take().context("File already closed")?;
                stream.flush()?;
                stream.sync_all()?;
                drop(stream);
                verify_file(&job.temporary.join(&file.name), file.size, &hash)?;
                file.sha256 = Some(hash);
            }
            "transfer_ready" => {
                let job = self.job.as_mut().context("Commit without transfer")?;
                let nonce = text(event, "nonce")?;
                ensure!(
                    job.published.is_none()
                        && text(event, "transfer_id")? == job.id
                        && nonce.len() == 32
                        && nonce.bytes().all(|b| b.is_ascii_hexdigit()),
                    "Unexpected commit challenge"
                );
                let regular: Vec<_> = job.files.values().filter(|file| !file.metadata).collect();
                ensure!(
                    regular.len() == job.count
                        && regular.iter().map(|file| file.size).sum::<u64>() == job.total
                        && job.files.values().all(|file| file.sha256.is_some())
                        && number(event, "files")? == job.files.len() as u64
                        && number(event, "total_bytes")?
                            == job.files.values().map(|file| file.size).sum::<u64>(),
                    "Cannot publish incomplete transfer"
                );
                verify_files(job)?;
                let destination =
                    self.directory
                        .join(format!("{}-{}", job.id, uuid::Uuid::new_v4().simple()));
                ensure!(!destination.exists(), "Destination collision");
                fs::rename(&job.temporary, &destination)?;
                job.published = Some(destination);
                output.acknowledgement = Some(format!("COMMIT {nonce}\n").into_bytes());
                output.event = Some(json!({"event":"incoming_verifying","transfer_id":job.id}));
            }
            "transfer_complete" => {
                let job = self.job.as_mut().context("Completion without transfer")?;
                ensure!(
                    !job.complete
                        && text(event, "transfer_id")? == job.id
                        && event["host_committed"] == true
                        && event["response_written"] == true,
                    "Native receiver did not confirm delivery"
                );
                let directory = job
                    .published
                    .as_ref()
                    .context("Completion without publication")?;
                verify_files(job)?;
                let files:Vec<_>=job.files.values().map(|file|json!({"name":file.name,"bytes":file.size,"sha256":file.sha256,"metadata":file.metadata})).collect();
                let receipt = json!({"event":"received","transfer_id":job.id,"directory":directory,"total_bytes":job.total,"files":files});
                let path = directory.with_extension("receipt.json");
                let mut record = OpenOptions::new().write(true).create_new(true).open(path)?;
                let payload = serde_json::to_vec_pretty(&receipt)?;
                record.write_all(&payload)?;
                record.sync_all()?;
                drop(record);
                ensure!(
                    fs::read(directory.with_extension("receipt.json"))? == payload,
                    "Saved receipt readback differs"
                );
                job.complete = true;
                output.event = Some(receipt);
            }
            _ => {}
        }
        Ok(output)
    }
}

fn verify_file(path: &std::path::Path, size: u64, expected: &str) -> Result<()> {
    let mut file = File::open(path)?;
    ensure!(
        file.metadata()?.is_file() && file.metadata()?.len() == size,
        "Saved file size differs"
    );
    let mut hash = Sha256::new();
    let mut total = 0_u64;
    let mut bytes = [0_u8; 65536];
    loop {
        let count = file.read(&mut bytes)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        ensure!(total <= size, "Saved file grew during verification");
        hash.update(&bytes[..count]);
    }
    ensure!(
        total == size && format!("{:x}", hash.finalize()) == expected,
        "Saved file SHA256 differs"
    );
    Ok(())
}
fn verify_files(job: &Job) -> Result<()> {
    let directory = job.published.as_ref().unwrap_or(&job.temporary);
    for file in job.files.values() {
        verify_file(
            &directory.join(&file.name),
            file.size,
            file.sha256.as_deref().context("Unchecked file")?,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn offer(receiver: &mut Receiver) {
        receiver
            .handle(
                &json!({"event":"transfer_begin","transfer_id":"TEST-1","files":1,"total_bytes":3}),
            )
            .unwrap();
        receiver.handle(&json!({"event":"manifest_file","index":0,"size":3,"name_b64":STANDARD.encode("file.bin")})).unwrap();
        receiver.handle(&json!({"event":"file_begin","index":0,"size":3,"name_b64":STANDARD.encode("file.bin"),"metadata":false})).unwrap();
    }
    fn checked(receiver: &mut Receiver) {
        offer(receiver);
        receiver
            .handle(&json!({"event":"file_chunk","index":0,"offset":0,"data":"YWJj"}))
            .unwrap();
        receiver.handle(&json!({"event":"file_end","index":0,"bytes":3,"sha256":format!("{:x}",Sha256::digest(b"abc"))})).unwrap();
    }
    fn commit() -> Value {
        json!({"event":"transfer_ready","transfer_id":"TEST-1","nonce":"a".repeat(32),"files":1,"total_bytes":3})
    }
    fn complete() -> Value {
        json!({"event":"transfer_complete","transfer_id":"TEST-1","host_committed":true,"response_written":true})
    }
    #[test]
    fn scanner_traffic_does_not_extend_receive_deadlines() {
        let temp = tempfile::tempdir().unwrap();
        let mut receiver = Receiver::new(temp.path().into()).unwrap();
        offer(&mut receiver);
        let start = receiver.job.as_ref().unwrap().progress_at;
        receiver
            .handle(&json!({"event":"scanner_status","peers":[]}))
            .unwrap();
        assert_eq!(receiver.job.as_ref().unwrap().progress_at, start);
        assert!(receiver
            .check_timeout(start + Duration::from_secs(60))
            .is_err());
        assert_eq!(receiver.take_failure().unwrap()["phase"], "receive_timeout");
        assert!(receiver.handle(&commit()).is_err());
    }
    #[test]
    fn detects_saved_file_changes_at_every_publication_boundary() {
        for phase in [0, 1, 2] {
            let temp = tempfile::tempdir().unwrap();
            let mut receiver = Receiver::new(temp.path().into()).unwrap();
            if phase == 0 {
                offer(&mut receiver);
                receiver
                    .handle(&json!({"event":"file_chunk","index":0,"offset":0,"data":"YWJj"}))
                    .unwrap();
            } else {
                checked(&mut receiver);
            }
            if phase == 2 {
                receiver.handle(&commit()).unwrap();
            }
            let job = receiver.job.as_ref().unwrap();
            let dir = job.published.as_ref().unwrap_or(&job.temporary).clone();
            fs::write(dir.join("file.bin"), b"xyz").unwrap();
            let result = if phase == 0 {
                receiver.handle(&json!({"event":"file_end","index":0,"bytes":3,"sha256":format!("{:x}",Sha256::digest(b"abc"))}))
            } else if phase == 1 {
                receiver.handle(&commit())
            } else {
                receiver.handle(&complete())
            };
            assert!(result.is_err());
            let failed = receiver.take_failure().unwrap();
            assert_eq!(failed["event"], "incoming_failed");
            assert_eq!(failed["uncertain"], phase == 2);
            assert!(receiver.handle(&complete()).is_err());
            assert!(!dir.with_extension("receipt.json").exists());
        }
    }
    #[test]
    fn completion_receipt_failure_does_not_claim_success() {
        let temp = tempfile::tempdir().unwrap();
        let mut receiver = Receiver::new(temp.path().into()).unwrap();
        checked(&mut receiver);
        receiver.handle(&commit()).unwrap();
        let path = receiver
            .job
            .as_ref()
            .unwrap()
            .published
            .as_ref()
            .unwrap()
            .with_extension("receipt.json");
        fs::create_dir(&path).unwrap();
        assert!(receiver.handle(&complete()).is_err());
        assert_eq!(receiver.take_failure().unwrap()["uncertain"], true);
        assert!(receiver.handle(&complete()).is_err());
    }
    #[test]
    fn rejects_wrong_transfer_and_oversized_metadata_without_recovering_the_job() {
        for wrong_identity in [true, false] {
            let temp = tempfile::tempdir().unwrap();
            let mut receiver = Receiver::new(temp.path().into()).unwrap();
            offer(&mut receiver);
            let invalid = if wrong_identity {
                json!({"event":"file_chunk","transfer_id":"OTHER","index":0,"offset":0,"data":"YWJj"})
            } else {
                json!({"event":"file_begin","index":16,"metadata":true,"size":131073,"name_b64":STANDARD.encode("._file.bin")})
            };
            assert!(receiver.handle(&invalid).is_err());
            assert!(receiver.take_failure().is_some());
            assert!(receiver.handle(&commit()).is_err());
        }
    }
    #[test]
    fn a_native_response_failure_cannot_be_repaired_by_a_later_success() {
        let temp = tempfile::tempdir().unwrap();
        let mut receiver = Receiver::new(temp.path().into()).unwrap();
        checked(&mut receiver);
        receiver.handle(&commit()).unwrap();
        let mut response = complete();
        response["response_written"] = json!(false);
        assert!(receiver.handle(&response).is_err());
        assert!(receiver.handle(&complete()).is_err());
    }
    #[test]
    fn refuses_offsets_and_unchecked_commit() {
        let temp = tempfile::tempdir().unwrap();
        let mut receiver = Receiver::new(temp.path().into()).unwrap();
        offer(&mut receiver);
        assert!(receiver
            .handle(&json!({"event":"file_chunk","index":0,"offset":1,"data":"YWJj"}))
            .is_err());
        assert!(receiver.handle(&json!({"event":"transfer_ready","transfer_id":"TEST-1","nonce":"0".repeat(32),"files":1,"total_bytes":3})).is_err());
    }
    #[test]
    fn publishes_checked_data_before_commit_and_waits_for_native_completion() {
        let temp = tempfile::tempdir().unwrap();
        let mut receiver = Receiver::new(temp.path().into()).unwrap();
        offer(&mut receiver);
        let chunk = receiver
            .handle(&json!({"event":"file_chunk","index":0,"offset":0,"data":"YWJj"}))
            .unwrap();
        assert_eq!(chunk.acknowledgement.unwrap(), b"CHUNK TEST-1 0 3\n");
        let hash = format!("{:x}", Sha256::digest(b"abc"));
        receiver
            .handle(&json!({"event":"file_end","index":0,"bytes":3,"sha256":hash}))
            .unwrap();
        let ready=receiver.handle(&json!({"event":"transfer_ready","transfer_id":"TEST-1","nonce":"a".repeat(32),"files":1,"total_bytes":3})).unwrap();
        assert_eq!(ready.event.as_ref().unwrap()["event"], "incoming_verifying");
        assert_ne!(ready.event.as_ref().unwrap()["event"], "received");
        assert!(ready.acknowledgement.unwrap().starts_with(b"COMMIT "));
        let result=receiver.handle(&json!({"event":"transfer_complete","transfer_id":"TEST-1","host_committed":true,"response_written":true})).unwrap().event.unwrap();
        let path = PathBuf::from(result["directory"].as_str().unwrap());
        assert_eq!(fs::read(path.join("file.bin")).unwrap(), b"abc");
        assert!(path.with_extension("receipt.json").is_file());
    }
}
