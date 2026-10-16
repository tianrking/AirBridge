// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
// Receive-only protocol qualification image. No AWDL presence or file service.
#include "awdl.hpp"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include <atomic>
#include <cstdio>
using namespace airbridge::awdl;
namespace {
struct Observation {Announcement announcement;std::uint64_t received;std::int8_t rssi;};
QueueHandle_t observations;
std::atomic<unsigned> accepted{},malformed{},queue_full{};
void on_frame(void* buffer,wifi_promiscuous_pkt_type_t type) {
    if(type!=WIFI_PKT_MGMT || !buffer) return;
    const auto* packet=static_cast<const wifi_promiscuous_pkt_t*>(buffer);
    if(packet->rx_ctrl.rx_state || packet->rx_ctrl.sig_len<44) return;
    Observation observation{};
    const auto result=parse_announcement({packet->payload,std::size_t(packet->rx_ctrl.sig_len)-4},observation.announcement);
    if(result==Error::not_awdl) return;
    if(result!=Error::none) {++malformed;return;}
    observation.received=std::uint64_t(esp_timer_get_time());observation.rssi=packet->rx_ctrl.rssi;
    if(xQueueSend(observations,&observation,0)==pdTRUE) ++accepted;else ++queue_full;
}
void print_mac(const Mac& value) {
    std::printf("\"%02x:%02x:%02x:%02x:%02x:%02x\"",value[0],value[1],value[2],value[3],value[4],value[5]);
}
void print_string(const char* value) {
    std::putchar('"');
    for(const unsigned char* p=reinterpret_cast<const unsigned char*>(value);*p;p++) {
        if(*p=='"' || *p=='\\') std::putchar('\\');
        if(*p<32) std::printf("\\u%04x",*p);else std::putchar(*p);
    }
    std::putchar('"');
}
}
extern "C" void app_main() {
    std::printf("{\"event\":\"qualification_boot\",\"receive_only\":true,\"native_transfer_verified\":false,\"reset_reason\":%d}\n",esp_reset_reason());
    auto check=[](esp_err_t error,const char* stage) {
        if(error!=ESP_OK) {std::printf("{\"event\":\"startup_failed\",\"stage\":\"%s\",\"code\":%d}\n",stage,int(error));return false;}
        return true;
    };
    if(!check(nvs_flash_init(),"nvs") || !check(esp_netif_init(),"netif") ||
       !check(esp_event_loop_create_default(),"events")) return;
    observations=xQueueCreate(16,sizeof(Observation));
    if(!observations) {std::puts("{\"event\":\"startup_failed\",\"stage\":\"queue\"}");return;}
    wifi_init_config_t config=WIFI_INIT_CONFIG_DEFAULT();
    if(!check(esp_wifi_init(&config),"wifi_init") || !check(esp_wifi_set_storage(WIFI_STORAGE_RAM),"wifi_storage") ||
       !check(esp_wifi_set_mode(WIFI_MODE_STA),"wifi_mode") || !check(esp_wifi_start(),"wifi_start") ||
       !check(esp_wifi_set_ps(WIFI_PS_NONE),"wifi_power_save") || !check(esp_wifi_set_channel(6,WIFI_SECOND_CHAN_NONE),"channel")) return;
    wifi_promiscuous_filter_t filter{};filter.filter_mask=WIFI_PROMIS_FILTER_MASK_MGMT;
    if(!check(esp_wifi_set_promiscuous_filter(&filter),"filter") || !check(esp_wifi_set_promiscuous_rx_cb(on_frame),"callback") ||
       !check(esp_wifi_set_promiscuous(true),"monitor")) return;
    Mac own{};esp_wifi_get_mac(WIFI_IF_STA,own.data());
    std::printf("{\"event\":\"scanner_ready\",\"channel\":6,\"native_transfer_verified\":false}\n");
    PeerTable peers;std::int64_t next=0;Observation observation{};
    for(;;) {
        if(xQueueReceive(observations,&observation,pdMS_TO_TICKS(100))==pdTRUE)
            peers.update(observation.announcement,observation.rssi,observation.received);
        const auto now=esp_timer_get_time();
        if(now<next) continue;
        next=now+1'000'000;
        std::printf("{\"event\":\"scanner_status\",\"accepted\":%u,\"malformed\":%u,\"queue_full\":%u,\"peers\":[",accepted.load(),malformed.load(),queue_full.load());
        bool comma=false;
        for(const auto& peer:peers.rows()) {
            if(!peer.used || std::uint64_t(now)<peer.seen_us || std::uint64_t(now)-peer.seen_us>10'000'000) continue;
            if(comma) std::putchar(',');comma=true;
            std::printf("{\"mac\":");print_mac(peer.announcement.source);
            std::printf(",\"rssi\":%d,\"host_label\":",int(peer.rssi));print_string(peer.announcement.hostname.data());
            std::printf(",\"name_source\":\"awdl_arpa\",\"channel6_mask\":%u,\"root_metric\":%lu,\"has_sync\":%s,\"has_election\":%s}",
                peer.announcement.channels.mask(6),static_cast<unsigned long>(peer.announcement.election.root_metric),
                peer.announcement.has_sync?"true":"false",peer.announcement.has_election?"true":"false");
        }
        std::printf("],\"selected_transmitter\":");
        const auto* selected=peers.select(own,std::uint64_t(now));
        if(selected) print_mac(selected->announcement.source);else std::printf("null");
        std::printf("}\n");std::fflush(stdout);
    }
}
