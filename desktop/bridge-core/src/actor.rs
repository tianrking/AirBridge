// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
use crate::client::{Client, Events};
use anyhow::{ensure, Context, Result};
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
        Arc,
    },
    thread::{self, JoinHandle},
};

enum Command {
    Send {
        path: PathBuf,
        peer: String,
        port: u16,
    },
    Status,
}
pub struct Actor {
    tx: SyncSender<Command>,
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    busy: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl Actor {
    pub fn start(directory: PathBuf, events: Events) -> Result<Self> {
        let (tx, rx) = mpsc::sync_channel(8);
        let stop = Arc::new(AtomicBool::new(false));
        let cancel = Arc::new(AtomicBool::new(false));
        let busy = Arc::new(AtomicBool::new(false));
        let worker_busy = busy.clone();
        let worker_stop = stop.clone();
        let worker_cancel = cancel.clone();
        let thread=thread::Builder::new().name("airbridge-serial".into()).spawn(move || {
            let run=||->Result<()> {
                let mut client=Client::open(directory,events.clone(),worker_stop.clone(),worker_cancel)?;
                loop {
                    if worker_stop.load(Ordering::Relaxed) {return Ok(());}
                    if let Ok(command)=rx.try_recv() {
                        match command {
                            Command::Send{path,peer,port}=>{
                                if let Err(error)=client.send(&path,&peer,port) {
                                    (events)(json!({"event":"operation_error","message":format!("{error:#}")}));
                                }
                                worker_busy.store(false,Ordering::Release);
                            }
                            Command::Status=>{let reply=client.request("STATUS")?;(events)(json!({"event":"device_status","status":reply}));}
                        }
                    }
                    client.poll()?;
                }
            };
            if let Err(error)=run() {(events)(json!({"event":"connection_error","message":format!("{error:#}")}));}
            (events)(json!({"event":"disconnected"}));
        })?;
        Ok(Self {
            tx,
            stop,
            cancel,
            busy,
            thread: Some(thread),
        })
    }
    pub fn send(&self, path: PathBuf, peer: String, port: u16) -> Result<()> {
        ensure!(
            self.busy
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_ok(),
            "A file operation is already active"
        );
        self.cancel.store(false, Ordering::Relaxed);
        if let Err(error) = self.tx.try_send(Command::Send { path, peer, port }) {
            self.busy.store(false, Ordering::Release);
            return Err(error).context("Serial actor is busy or disconnected");
        }
        Ok(())
    }
    pub fn status(&self) -> Result<()> {
        self.tx
            .try_send(Command::Status)
            .context("Serial actor is busy or disconnected")
    }
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
    pub fn finished(&self) -> bool {
        self.thread
            .as_ref()
            .is_none_or(|thread| thread.is_finished())
    }
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.cancel.store(true, Ordering::Relaxed);
    }
}
impl Drop for Actor {
    fn drop(&mut self) {
        self.stop();
        // The reader has a bounded timeout. Join before another actor may claim
        // the port; never leave an orphan serial owner after disconnect.
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
