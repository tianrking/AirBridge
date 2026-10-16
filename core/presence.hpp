// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "awdl.hpp"
namespace airbridge::awdl {
struct Presence {
    Mac source{},destination{},root{},parent{};
    std::array<char,64> host_label{};
    std::uint32_t root_metric{},root_counter{},self_metric{},self_counter{},depth{};
    Clock clock{};
    ChannelPlan advertised{};
};
struct ManagementFrame {std::array<std::uint8_t,512> bytes{};std::size_t length{};};
Error encode_presence(const Presence& state,std::uint8_t kind,std::uint16_t sequence,
                      std::uint64_t now_us,ManagementFrame& output);
struct DataFrame {std::array<std::uint8_t,1322> bytes{};std::size_t length{};};
Error encode_ipv6(const Mac& source,const Mac& destination,std::uint16_t data_sequence,
                  std::uint16_t wifi_sequence,Bytes packet,DataFrame& output);
}
