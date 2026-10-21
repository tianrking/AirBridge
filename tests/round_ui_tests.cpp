#include <cassert>
#include <cstring>
#include <limits>

#include "round_ui.hpp"
using namespace airbridge;
int main() {
    round_ui::State state;
    awdl::PeerTable table;
    awdl::Announcement announcement{};
    announcement.source = {2, 1, 2, 3, 4, 5};
    announcement.service.airdrop = true;
    announcement.service.port = 8770;
    std::strcpy(announcement.hostname.data(), "observed-host");
    table.update(announcement, -68, 1'000'000);
    state.observe(table, 1'100'000);
    assert(state.count(1'100'000) == 1);
    assert(state.select(announcement.source, 1'100'000));
    assert(!state.find(announcement.source)->resolved);
    assert(state.set_name(announcement.source, "Studio MacBook"));
    assert(state.find(announcement.source)->resolved);
    round_ui::Action action{};
    assert(state.action(round_ui::ActionKind::allow, 1'200'000, action));
    assert(action.peer == announcement.source && action.port == 8770);
    assert(!state.action(round_ui::ActionKind::allow, 11'000'000, action));
    assert(!state.action(round_ui::ActionKind::resolve, 0, action));
    assert(!state.select({2, 9, 9, 9, 9, 9}, 1'100'000));
    assert(!state.set_name({2, 9, 9, 9, 9, 9}, "Unknown"));
    assert(!state.set_name(announcement.source, ""));
    auto& receive = state.transfers[0];
    auto& send = state.transfers[1];
    receive.phase = round_ui::Phase::receiving;
    receive.total = receive.done = 262145;
    send.phase = round_ui::Phase::sending;
    send.total = 65537;
    send.done = 42;
    assert(receive.progress() == 999);
    state.finish_receive(true, false, 1'300'000);
    assert(receive.phase == round_ui::Phase::uncertain && receive.progress() < 1000);
    assert(send.phase == round_ui::Phase::sending && send.done == 42);
    assert(state.action(round_ui::ActionKind::cancel, 1'400'000, action));
    receive.phase = round_ui::Phase::verifying;
    state.finish_receive(true, true, 1'500'000);
    assert(receive.phase == round_ui::Phase::complete && receive.progress() == 1000);
    state.receive_closed(2'000'000);
    assert(receive.phase == round_ui::Phase::complete);
    receive.phase = round_ui::Phase::receiving;
    state.receive_closed(2'000'000);
    assert(receive.phase == round_ui::Phase::uncertain);
    send.total = std::numeric_limits<std::uint64_t>::max();
    send.done = send.total;
    assert(send.progress() == 999);
    send.phase = round_ui::Phase::idle;
    assert(!state.action(round_ui::ActionKind::cancel, 2'000'000, action));
    assert(state.action(round_ui::ActionKind::revoke, 2'000'000, action));
    state.observe(table, 12'000'000);
    assert(state.count(12'000'000) == 0);
    assert(!state.action(round_ui::ActionKind::allow, 12'000'000, action));
    // Reappearance keeps selection tied to a MAC, never a recycled row number.
    auto other = announcement;
    other.source[5] = 8;
    table.update(other, -55, 13'000'000);
    state.observe(table, 13'000'001);
    assert(state.count(13'000'001) == 1);
    assert(!state.action(round_ui::ActionKind::allow, 13'000'001, action));
    send.phase = round_ui::Phase::preparing;
    state.host_reply(false, "offset_or_length", 14'000'000);
    assert(send.phase == round_ui::Phase::preparing);
    state.host_reply(false, "sha256_mismatch", 14'000'001);
    assert(send.phase == round_ui::Phase::failed && send.progress() != 1000);
    send.phase = round_ui::Phase::preparing;
    state.host_reply(true, "cancelled", 14'000'002);
    assert(send.phase == round_ui::Phase::uncertain);
    send.phase = round_ui::Phase::sending;
    state.host_reply(true, "cancelled", 14'000'003);
    assert(send.phase == round_ui::Phase::sending);  // Wait for the native worker outcome.
    // A live AWDL neighbor remains visible without a fresh AirDrop offer.
    round_ui::State observed_state;
    awdl::PeerTable observed_table;
    awdl::Announcement live{};
    live.source = {2, 5, 4, 3, 2, 1};
    observed_table.update(live, -73, 1'000'000);
    observed_state.observe(observed_table, 1'000'001);
    assert(observed_state.count(1'000'001) == 1 && observed_state.ready_count(1'000'001) == 0);
    assert(observed_state.select(live.source, 1'000'001));
    assert(!observed_state.action(round_ui::ActionKind::allow, 1'000'001, action));
    assert(!observed_state.action(round_ui::ActionKind::resolve, 1'000'001, action));
    live.service.airdrop = true;
    live.service.port = 8770;
    observed_table.update(live, -73, 2'000'000);
    observed_state.observe(observed_table, 2'000'001);
    assert(observed_state.ready_count(2'000'001) == 1);
    assert(observed_state.action(round_ui::ActionKind::allow, 2'000'001, action));
    live.service = {};
    for (auto time : {5'000'000ull, 9'000'000ull, 13'000'000ull}) {
        observed_table.update(live, -73, time);
        observed_state.observe(observed_table, time + 1);
    }
    assert(observed_state.count(13'000'001) == 1 && observed_state.ready_count(13'000'001) == 0);
    assert(observed_state.select(live.source, 13'000'001));
    assert(!observed_state.action(round_ui::ActionKind::allow, 13'000'001, action));
    assert(!observed_state.action(round_ui::ActionKind::resolve, 13'000'001, action));
    assert(observed_state.count(23'000'001) == 0);
    assert(observed_state.count(0) == 0);
}
