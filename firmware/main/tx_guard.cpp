// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
// ESP-IDF 6.1 S3 diagnostic ABI adapter, restricted to this radio's AWDL frames.
#include "awdl.hpp"
#include "esp_err.h"
#include <atomic>
#include <cstring>
namespace {airbridge::awdl::Mac own{};std::atomic<bool> configured{};}
extern "C" void airbridge_set_tx_identity(const std::uint8_t* address) {
    if(configured.load(std::memory_order_acquire)) return;
    std::memcpy(own.data(),address,6);configured.store(true,std::memory_order_release);
}
extern "C" int ieee80211_raw_frame_sanity_check(int interface_id,const void* buffer,int length,bool system_sequence) {
    using namespace airbridge::awdl;
    if(!configured.load(std::memory_order_acquire) || interface_id!=0 || !system_sequence || !buffer || length<40 || length>1322) return ESP_ERR_INVALID_ARG;
    const auto* p=static_cast<const std::uint8_t*>(buffer);
    constexpr std::uint8_t bssid[]={0,0x25,0,0xff,0x94,0x73};
    if(std::memcmp(p+10,own.data(),6) || std::memcmp(p+16,bssid,6)) return ESP_ERR_INVALID_ARG;
    if((p[0]&0xfc)==0xd0) {
        if(length>512) return ESP_ERR_INVALID_ARG;
        Announcement parsed{};
        return parse_announcement({p,std::size_t(length)},parsed)==Error::none ? ESP_OK : ESP_ERR_INVALID_ARG;
    }
    Ipv6Frame parsed{};
    if(parse_ipv6({p,std::size_t(length)},parsed)!=Error::none) return ESP_ERR_INVALID_ARG;
    const auto local=link_local(own);
    return std::memcmp(parsed.packet.data+8,local.data(),16)==0 ? ESP_OK : ESP_ERR_INVALID_ARG;
}
