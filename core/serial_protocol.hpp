// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "awdl.hpp"
namespace airbridge::serial {
std::uint32_t crc32(awdl::Bytes input);
struct Command {std::uint32_t sequence{},checksum{};std::array<char,193> body{};};
awdl::Error parse_command(awdl::Bytes line,Command& output);
enum class Replay {fresh,repeat,conflict,stale};
class ReplayGuard {
public:
    Replay check(const Command& command) const;
    void remember(const Command& command) {last_=command;initialized_=true;}
    void reset() {initialized_=false;}
private:
    Command last_{};bool initialized_{};
};
}
