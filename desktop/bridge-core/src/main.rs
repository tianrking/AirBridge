// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
use airbridge_host::actor::Actor;
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let mut directory = PathBuf::from("received/rust");
    let mut source = None;
    let mut peer = None;
    let mut seconds = 300u64;
    while let Some(option) = args.next() {
        match option.as_str() {
            "--directory"=>directory=PathBuf::from(args.next().context("Missing receive directory")?),
            "--send"=>source=Some(PathBuf::from(args.next().context("Missing source file")?)),
            "--peer"=>peer=Some(args.next().context("Missing peer MAC")?),
            "--seconds"=>seconds=args.next().context("Missing duration")?.parse()?,
            "--ports"=>{
                for port in serialport::available_ports()? {println!("{}",json!({"port":port.port_name,"type":format!("{:?}",port.port_type)}));}
                return Ok(());
            }
            _=>bail!("Usage: airbridge-host [--directory PATH] [--send FILE --peer AWDL_MAC] [--seconds N] [--ports]"),
        }
    }
    let (tx, rx) = mpsc::channel::<Value>();
    let events = Arc::new(move |event: Value| {
        let _ = tx.send(event);
    });
    let mut actor = Actor::start(directory, events)?;
    let end = Instant::now() + Duration::from_secs(seconds);
    let mut pending_source = source;
    let mut connected = false;
    while seconds == 0 || Instant::now() < end {
        if let Ok(event) = rx.recv_timeout(Duration::from_millis(100)) {
            if event["event"] == "connected" {
                connected = true;
            }
            if event["event"] != "peers" {
                println!("{event}");
            }
            if event["event"] == "connection_error" {
                bail!("Serial actor failed: {}", event["message"]);
            }
            if event["event"] == "disconnected" {
                break;
            }
        }
        if connected {
            if let Some(path) = pending_source.take() {
                actor.send(path, peer.clone().context("--send requires --peer")?, 8770)?;
            }
        }
        if actor.finished() {
            break;
        }
    }
    actor.stop();
    drop(actor);
    Ok(())
}
