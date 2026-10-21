// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "round_ui.hpp"

#include <algorithm>
#include <cstdio>
#include <cstring>
namespace airbridge::round_ui {
bool Transfer::active() const {
    return phase == Phase::preparing || phase == Phase::sending || phase == Phase::receiving ||
           phase == Phase::verifying;
}
unsigned Transfer::progress() const {
    if (phase == Phase::complete)
        return 1000;
    if (!total)
        return 0;
    // An in-flight 100% byte count is not a native/persisted success.
    return std::min(999u, unsigned((double(std::min(done, total)) / double(total)) * 1000));
}
const Peer* State::find(const awdl::Mac& mac) const {
    for (const auto& peer : peers)
        if (peer.used && peer.mac == mac)
            return &peer;
    return nullptr;
}
bool State::observed(const Peer& peer, std::uint64_t now) const {
    return peer.used && now >= peer.seen && now - peer.seen < peer_lifetime_us;
}
bool State::eligible(const Peer& peer, std::uint64_t now) const {
    return observed(peer, now) && peer.port && peer.advertised_at && now >= peer.advertised_at &&
           now - peer.advertised_at < peer_lifetime_us;
}
unsigned State::count(std::uint64_t now) const {
    unsigned count = 0;
    for (const auto& peer : peers)
        if (observed(peer, now))
            ++count;
    return count;
}
unsigned State::ready_count(std::uint64_t now) const {
    unsigned count = 0;
    for (const auto& peer : peers)
        if (eligible(peer, now))
            ++count;
    return count;
}
void State::observe(const awdl::PeerTable& table, std::uint64_t now) {
    for (auto& peer : peers)
        if (peer.used && (now < peer.seen || now - peer.seen >= peer_lifetime_us))
            peer.used = false;
    for (const auto& source : table.rows()) {
        if (!source.used || now < source.seen_us || now - source.seen_us >= peer_lifetime_us)
            continue;
        Peer* destination = nullptr;
        for (auto& peer : peers)
            if (peer.used && peer.mac == source.announcement.source)
                destination = &peer;
        if (!destination)
            for (auto& peer : peers)
                if (!peer.used) {
                    destination = &peer;
                    break;
                }
        if (!destination)
            continue;
        if (!destination->used) {
            *destination = {};
            destination->mac = source.announcement.source;
        }
        destination->used = true;
        destination->port =
            source.announcement.service.airdrop ? source.announcement.service.port : 0;
        destination->seen = source.seen_us;
        destination->advertised_at = source.service_received_us;
        destination->rssi = source.rssi;
        destination->host = source.announcement.hostname;
    }
    ++revision;
}
bool State::set_name(const awdl::Mac& mac, const char* name) {
    if (!name || !*name || std::strlen(name) >= 256)
        return false;
    for (auto& peer : peers)
        if (peer.used && peer.mac == mac) {
            std::snprintf(peer.name.data(), peer.name.size(), "%s", name);
            peer.resolved = true;
            ++revision;
            return true;
        }
    return false;
}
bool State::select(const awdl::Mac& mac, std::uint64_t now) {
    const auto* peer = find(mac);
    if (!peer || !observed(*peer, now))
        return false;
    selected = mac;
    ++revision;
    return true;
}
bool State::action(ActionKind kind, std::uint64_t now, Action& output) const {
    if (kind == ActionKind::cancel) {
        if (!transfers[1].active())
            return false;
        output = {kind, {}, 0};
        return true;
    }
    if (kind == ActionKind::revoke) {
        output = {kind, {}, 0};
        return true;
    }
    const auto* peer = find(selected);
    if (!peer || !eligible(*peer, now))
        return false;
    output = {kind, peer->mac, peer->port};
    return true;
}
void State::message(const char* text) {
    std::snprintf(notice.data(), notice.size(), "%s", text ? text : "");
    ++revision;
}
void State::host_reply(bool okay, const char* reason, std::uint64_t now) {
    auto& outgoing = transfers[1];
    if (outgoing.phase != Phase::preparing || !reason)
        return;
    if (okay && (!std::strcmp(reason, "cancelled") || !std::strcmp(reason, "hello") ||
                 !std::strcmp(reason, "idle"))) {
        outgoing.phase = Phase::uncertain;
        outgoing.updated = now;
        ++revision;
    } else if (!okay && (!std::strcmp(reason, "sha256_mismatch") ||
                         !std::strcmp(reason, "manifest_mismatch"))) {
        outgoing.phase = Phase::failed;
        outgoing.updated = now;
        ++revision;
    }
}
void State::finish_receive(bool committed, bool response_written, std::uint64_t now) {
    auto& incoming = transfers[0];
    if (!incoming.active())
        return;
    incoming.phase = committed && response_written ? Phase::complete : Phase::uncertain;
    incoming.updated = now;
    ++revision;
}
void State::receive_closed(std::uint64_t now) {
    if (transfers[0].active()) {
        transfers[0].phase = Phase::uncertain;
        transfers[0].updated = now;
        ++revision;
    }
}
}  // namespace airbridge::round_ui
