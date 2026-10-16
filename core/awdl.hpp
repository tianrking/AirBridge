// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

namespace airbridge::awdl {
using Mac = std::array<std::uint8_t, 6>;
struct Bytes { const std::uint8_t* data; std::size_t size; };
enum class Error { none, not_awdl, truncated, malformed, unsupported, duplicate };
struct Sync {
    Mac root{};
    std::uint16_t countdown_tu{}, aw_number{}, aw_period_tu{};
    std::uint8_t presence{};
};
struct Election {
    Mac root{}, parent{};
    std::uint32_t root_counter{}, depth{}, root_metric{}, self_metric{}, self_counter{};
    bool modern{};
};
struct ChannelPlan {
    std::array<std::uint8_t,16> channel{};
    std::uint8_t encoding{}, slot_aw_count{};
    std::uint16_t mask(std::uint8_t wanted) const;
};
struct Announcement {
    Mac source{}, destination{};
    std::uint32_t sender_timestamp{};
    std::uint8_t kind{}, version{}, device_class{};
    bool has_sync{}, has_election{}, has_channels{}, has_hostname{};
    Sync sync{};
    Election election{};
    ChannelPlan channels{};
    // AWDL host label, not the AirDrop /Discover display name.
    std::array<char,64> hostname{};
};
Error parse_announcement(Bytes frame, Announcement& output);
struct Ipv6Frame { Mac source{},destination{};std::uint16_t sequence{};Bytes packet{}; };
Error parse_ipv6(Bytes frame, Ipv6Frame& output);
std::array<std::uint8_t,16> link_local(const Mac& mac);

// All anchors are local monotonic receive times. Sender clocks are never mixed
// with local esp_timer values or used as a substitute for the actual transmitter.
class Clock {
public:
    bool observe(const Sync& sync, std::uint64_t received_us);
    bool valid() const { return valid_; }
    std::uint16_t aw_number(std::uint64_t now_us) const;
    std::uint16_t countdown_tu(std::uint64_t now_us) const;
    std::uint8_t slot(std::uint64_t now_us) const;
private:
    bool valid_{};
    std::uint64_t boundary_us_{};
    std::uint16_t boundary_aw_{},period_tu_{};
    std::uint8_t presence_{};
};

struct Peer { Announcement announcement{};std::uint64_t seen_us{},sync_received_us{};std::int8_t rssi{};bool used{}; };
class PeerTable {
public:
    static constexpr std::size_t capacity=12;
    void update(const Announcement& announcement,std::int8_t rssi,std::uint64_t now_us);
    const Peer* select(const Mac& self,std::uint64_t now_us) const;
    const std::array<Peer,capacity>& rows() const { return rows_; }
private:
    std::array<Peer,capacity> rows_{};
};
} // namespace airbridge::awdl
