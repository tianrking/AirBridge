// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "esp_err.h"
#include "round_ui.hpp"
namespace airbridge::round_display {
using Record = bool (*)(const char*, std::size_t);
esp_err_t begin(Record output);
void observe(const awdl::PeerTable& peers, std::uint64_t now);
void radio_ready(const awdl::Mac& mac);
void serial_event(const char* bytes, std::size_t length);
void host_activity();
void receive_bytes(std::size_t bytes);
void stage_outgoing(std::size_t bytes, std::size_t total, const char* name = nullptr);
bool next_action(round_ui::Action& action);
void action_result(const round_ui::Action& action, bool okay, const char* reason);
bool diagnostic_command(const char* command);
}  // namespace airbridge::round_display
