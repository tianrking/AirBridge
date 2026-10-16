// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "archive.hpp"
namespace airbridge::native {
using awdl::Bytes;using awdl::Error;
struct MdnsPacket {std::array<std::uint8_t,512> bytes{};std::size_t size{};};
Error mdns_announcement(const awdl::Mac& own,std::uint16_t port,std::uint16_t id,MdnsPacket& result);
bool mdns_question(Bytes packet,const awdl::Mac& own);
struct OfferedFile {std::array<char,256> name{};std::uint32_t size{};};
struct AskManifest {
    std::array<char,65> transfer_id{};
    std::array<char,256> sender{};
    std::array<OfferedFile,16> files{};
    unsigned count{};std::uint64_t total{};
};
Error parse_ask(Bytes plist,AskManifest& result);
struct Request {
    std::array<char,32> path{};
    std::array<char,65> transfer_id{};
    std::array<char,64> content_type{};
    std::uint64_t length{},total_bytes{};
    bool chunked{},has_length{},has_total{},expect_continue{};
};
Error parse_request(Bytes headers,Request& result);
class BodyDecoder {
public:
    BodyDecoder(const Request& request,transfer::Emit emit,void* context);
    Error feed(Bytes input,std::size_t& consumed);
    bool complete() const;
private:
    enum class State {length,data,cr,lf,trailers,done,failed};
    State state_;bool chunked_;
    std::uint64_t remaining_{},total_{};
    std::array<char,128> line_{};std::size_t used_{},trailer_bytes_{};
    transfer::Emit emit_;void* context_;
};
}
