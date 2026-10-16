// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "discover.hpp"
struct DiscoveryResult {
    airbridge::awdl::Mac peer{};
    airbridge::discovery::Identity identity{};
    unsigned http_status{};
    int error{};
    std::array<char,24> stage{};
};
bool discovery_probe_start(const airbridge::awdl::Mac& peer,std::uint16_t port);
bool discovery_probe_poll(DiscoveryResult& result);
