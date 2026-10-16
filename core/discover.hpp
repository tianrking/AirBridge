// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "awdl.hpp"
namespace airbridge::discovery {
struct Identity {
    std::array<char,256> name{};
    std::array<char,64> model{};
    bool has_airdropable{},airdropable{};
};
awdl::Error parse_identity_plist(awdl::Bytes body,Identity& output);
std::array<std::uint8_t,72> discover_request(std::uint32_t support_flags);
struct HttpResponse {unsigned status{};awdl::Bytes body{};};
// Only a complete valid response is unchunked in place. Truncated input is unchanged.
awdl::Error parse_http_response(std::uint8_t* wire,std::size_t size,HttpResponse& output,bool eof=false);
}
