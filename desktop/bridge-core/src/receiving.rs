// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
use crate::protocol::{digest, identity, safe_name};
use anyhow::{anyhow, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::Write,
    path::PathBuf,
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
}
#[derive(Default)]
pub struct Handled {
    pub acknowledgement: Option<Vec<u8>>,
    pub event: Option<Value>,
}
pub struct Receiver {
    directory: PathBuf,
    job: Option<Job>,
}
impl Receiver {
    pub fn new(directory: PathBuf) -> Result<Self> {
        fs::create_dir_all(&directory)?;
        Ok(Self {
            directory: fs::canonicalize(directory)?,
            job: None,
        })
    }
    pub fn handle(&mut self, event: &Value) -> Result<Handled> {
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
                });
                output.event = Some(
                    json!({"event":"incoming_started","transfer_id":id,"files":count,"bytes":total}),
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
                        && size <= 64 * 1024 * 1024
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
                let files:Vec<_>=job.files.values().map(|file|json!({"name":file.name,"bytes":file.size,"sha256":file.sha256,"metadata":file.metadata})).collect();
                let receipt = json!({"event":"received","transfer_id":job.id,"directory":directory,"total_bytes":job.total,"files":files});
                let path = directory.with_extension("receipt.json");
                let mut record = OpenOptions::new().write(true).create_new(true).open(path)?;
                record.write_all(&serde_json::to_vec_pretty(&receipt)?)?;
                record.sync_all()?;
                job.complete = true;
                output.event = Some(receipt);
            }
            _ => {}
        }
        Ok(output)
    }
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
        assert!(receiver
            .handle(&json!({"event":"file_end","index":0,"bytes":3,"sha256":"0".repeat(64)}))
            .is_err());
        let hash = format!("{:x}", Sha256::digest(b"abc"));
        receiver
            .handle(&json!({"event":"file_end","index":0,"bytes":3,"sha256":hash}))
            .unwrap();
        let ready=receiver.handle(&json!({"event":"transfer_ready","transfer_id":"TEST-1","nonce":"a".repeat(32),"files":1,"total_bytes":3})).unwrap();
        assert_eq!(ready.event.as_ref().unwrap()["event"], "incoming_verifying");
        assert_ne!(ready.event.as_ref().unwrap()["event"], "received");
        assert!(ready.acknowledgement.unwrap().starts_with(b"COMMIT "));
        assert!(receiver.handle(&json!({"event":"transfer_complete","transfer_id":"TEST-1","host_committed":true,"response_written":false})).is_err());
        let result=receiver.handle(&json!({"event":"transfer_complete","transfer_id":"TEST-1","host_committed":true,"response_written":true})).unwrap().event.unwrap();
        let path = PathBuf::from(result["directory"].as_str().unwrap());
        assert_eq!(fs::read(path.join("file.bin")).unwrap(), b"abc");
        assert!(path.with_extension("receipt.json").is_file());
    }
}
