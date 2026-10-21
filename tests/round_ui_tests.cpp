#include "round_ui.hpp"
#include <cassert>
#include <cstring>
#include <limits>
using namespace airbridge;
int main() {
    round_ui::State state;
    awdl::PeerTable table;
    awdl::Announcement announcement{};
    announcement.source = {2,1,2,3,4,5};
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
    assert(!state.select({2,9,9,9,9,9}, 1'100'000));
    assert(!state.set_name({2,9,9,9,9,9}, "Unknown"));
    assert(!state.set_name(announcement.source, ""));
    auto& receive = state.transfers[0];
    auto& send = state.transfers[1];
    receive.phase = round_ui::Phase::receiving; receive.total = receive.done = 262145;
    send.phase = round_ui::Phase::sending; send.total = 65537; send.done = 42;
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
    send.total = std::numeric_limits<std::uint64_t>::max(); send.done = send.total;
    assert(send.progress() == 999);
    send.phase = round_ui::Phase::idle;
    assert(!state.action(round_ui::ActionKind::cancel, 2'000'000, action));
    assert(state.action(round_ui::ActionKind::revoke, 2'000'000, action));
    state.observe(table, 12'000'000);
    assert(state.count(12'000'000) == 0);
    assert(!state.action(round_ui::ActionKind::allow, 12'000'000, action));
    // Reappearance keeps selection tied to a MAC, never a recycled row number.
    auto other = announcement; other.source[5] = 8;
    table.update(other, -55, 13'000'000); state.observe(table, 13'000'001);
    assert(state.count(13'000'001) == 1);
    assert(!state.action(round_ui::ActionKind::allow, 13'000'001, action));
}
