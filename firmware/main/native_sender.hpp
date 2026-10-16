// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "awdl.hpp"
void native_sender_begin(const airbridge::awdl::Mac& own, const airbridge::awdl::Mac& permitted);
// Called by the sole serial command task, with the complete newline-terminated record.
bool native_sender_command(airbridge::awdl::Bytes line);
void native_sender_observe(const airbridge::awdl::Announcement& peer, std::uint64_t received_us);
bool native_sender_sync_peer(airbridge::awdl::Mac& peer);
