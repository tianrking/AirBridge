// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "awdl.hpp"
namespace airbridge::round_ui {
constexpr std::uint64_t peer_lifetime_us = 10'000'000;
struct Peer {
    awdl::Mac mac{};
    std::array<char, 256> name{};
    std::array<char, 64> host{};
    std::uint64_t seen{}, advertised_at{};
    std::uint16_t port{};
    std::int8_t rssi{};
    bool used{}, resolved{};
};
enum class Phase { idle, preparing, sending, receiving, verifying, complete, failed, uncertain };
enum class ActionKind { resolve, allow, revoke, cancel };
struct Action {
    ActionKind kind{};
    awdl::Mac peer{};
    std::uint16_t port{};
};
struct Transfer {
    Phase phase{};
    std::array<char, 256> name{};
    std::array<char, 65> id{};
    std::uint64_t done{}, total{}, updated{};
    std::uint32_t files{};
    unsigned progress() const;
    bool active() const;
};
struct State {
    std::array<Peer, 12> peers{};
    awdl::Mac selected{}, allowed{}, radio_mac{};
    std::array<Transfer, 2> transfers{};  // Receive and send remain independent.
    std::array<char, 80> notice{};
    bool radio_ready{};
    unsigned brightness{65};
    std::uint64_t host_activity{}, revision{};
    void observe(const awdl::PeerTable& table, std::uint64_t now);
    bool set_name(const awdl::Mac& mac, const char* name);
    const Peer* find(const awdl::Mac& mac) const;
    bool observed(const Peer& peer, std::uint64_t now) const;
    bool eligible(const Peer& peer, std::uint64_t now) const;
    unsigned count(std::uint64_t now) const;
    unsigned ready_count(std::uint64_t now) const;
    bool select(const awdl::Mac& mac, std::uint64_t now);
    bool action(ActionKind kind, std::uint64_t now, Action& output) const;
    void message(const char* text);
    void host_reply(bool okay, const char* reason, std::uint64_t now);
    void finish_receive(bool committed, bool response_written, std::uint64_t now);
    void receive_closed(std::uint64_t now);
};
}  // namespace airbridge::round_ui
