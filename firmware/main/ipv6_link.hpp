// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "awdl.hpp"
#include "esp_err.h"
struct LinkCounters {unsigned rx{},rx_dropped{},tx_queued{},tx_admitted{},tx_completed{},tx_failed{},tx_inflight{};};
esp_err_t ipv6_link_begin(const airbridge::awdl::Mac& own);
void ipv6_link_receive(const airbridge::awdl::Ipv6Frame& frame);
void ipv6_link_poll(const airbridge::awdl::PeerTable& peers,std::uint64_t now);
LinkCounters ipv6_link_counters();
unsigned ipv6_link_index();
