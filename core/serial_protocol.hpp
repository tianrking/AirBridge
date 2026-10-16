// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "awdl.hpp"
namespace airbridge::serial {
std::uint32_t crc32(awdl::Bytes input);
enum class LineResult {pending,ready,overflow};
class LineDecoder {
public:
    LineResult push(std::uint8_t byte,awdl::Bytes& output);
    void reset() {used_=0;dropping_=false;}
private:
    std::array<std::uint8_t,224> bytes_{};
    std::size_t used_{};
    bool dropping_{};
};
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
