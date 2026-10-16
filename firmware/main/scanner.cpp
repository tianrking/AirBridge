// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
// Receive-only protocol qualification image. No AWDL presence or file service.
#include "awdl.hpp"
#include "presence.hpp"
#ifdef AIRBRIDGE_IPV6_LINK
#include "ipv6_link.hpp"
#endif
#ifdef AIRBRIDGE_DISCOVER_PROBE
#include "discovery_probe.hpp"
#endif
#ifdef AIRBRIDGE_NATIVE_SERVICE
#include "native_receiver.hpp"
#include "ble_presence.hpp"
#include "serial_channel.hpp"
#endif
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "esp_system.h"
#include "esp_random.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include <atomic>
#include <algorithm>
#include <cstdio>
using namespace airbridge::awdl;
#ifdef AIRBRIDGE_PRESENCE_TX
extern "C" void airbridge_set_tx_identity(const std::uint8_t* address);
#endif
namespace {
struct Observation {Announcement announcement;std::uint64_t received;std::int8_t rssi;};
QueueHandle_t observations;
std::atomic<unsigned> accepted{},malformed{},queue_full{};
std::array<std::atomic<unsigned>,6> failures{};
#ifdef AIRBRIDGE_SCAN_CAPTURE
std::atomic<unsigned> sample_state{};
std::array<std::uint8_t,512> sample{};
std::size_t sample_length{};
#endif
void on_frame(void* buffer,wifi_promiscuous_pkt_type_t type) {
    if(!buffer) return;
    const auto* packet=static_cast<const wifi_promiscuous_pkt_t*>(buffer);
    if(packet->rx_ctrl.rx_state || packet->rx_ctrl.sig_len<44) return;
#ifdef AIRBRIDGE_IPV6_LINK
    if(type==WIFI_PKT_DATA) {
        Ipv6Batch parsed{};
        if(parse_ipv6_batch({packet->payload,std::size_t(packet->rx_ctrl.sig_len)-4},parsed)==Error::none)
            for(std::size_t i=0;i<parsed.count;i++) ipv6_link_receive(parsed.frames[i]);
        return;
    }
#endif
    if(type!=WIFI_PKT_MGMT) return;
    Observation observation{};
    const auto result=parse_announcement({packet->payload,std::size_t(packet->rx_ctrl.sig_len)-4},observation.announcement);
    if(result==Error::not_awdl) return;
    if(result!=Error::none) {
        ++malformed;++failures[static_cast<unsigned>(result)];
#ifdef AIRBRIDGE_SCAN_CAPTURE
        unsigned empty=0;
        if(sample_state.compare_exchange_strong(empty,1)) {
            sample_length=std::min(std::size_t(packet->rx_ctrl.sig_len)-4,sample.size());
            std::copy_n(packet->payload,sample_length,sample.begin());
            sample_state.store(2,std::memory_order_release);
        }
#endif
        return;
    }
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
#ifdef AIRBRIDGE_NATIVE_SERVICE
    if(serial_channel_begin()!=ESP_OK) {std::puts("{\"event\":\"serial_driver_failed\"}");return;}
#endif
#ifdef AIRBRIDGE_PRESENCE_TX
    constexpr const char* receive_only="false";
#else
    constexpr const char* receive_only="true";
#endif
    std::printf("{\"event\":\"qualification_boot\",\"receive_only\":%s,\"native_transfer_verified\":false,\"reset_reason\":%d}\n",receive_only,esp_reset_reason());
    auto check=[](esp_err_t error,const char* stage) {
        if(error!=ESP_OK) {std::printf("{\"event\":\"startup_failed\",\"stage\":\"%s\",\"code\":%d}\n",stage,int(error));return false;}
        return true;
    };
    if(!check(nvs_flash_init(),"nvs") || !check(esp_netif_init(),"netif") ||
       !check(esp_event_loop_create_default(),"events")) return;
#ifdef AIRBRIDGE_NATIVE_SERVICE
    if(!check(ble_presence_begin(),"ble_presence")) return;
#endif
    observations=xQueueCreate(16,sizeof(Observation));
    if(!observations) {std::puts("{\"event\":\"startup_failed\",\"stage\":\"queue\"}");return;}
    wifi_init_config_t config=WIFI_INIT_CONFIG_DEFAULT();
    if(!check(esp_wifi_init(&config),"wifi_init") || !check(esp_wifi_set_storage(WIFI_STORAGE_RAM),"wifi_storage") ||
       !check(esp_wifi_set_mode(WIFI_MODE_STA),"wifi_mode")) return;
#ifdef AIRBRIDGE_PRESENCE_TX
    // A boot-local unicast identity avoids stale Apple neighbor/service entries
    // surviving a replaced development image. USB hardware identity is separate.
    Mac identity{};esp_fill_random(identity.data(),identity.size());identity[0]=(identity[0]&0xfc)|2;
#ifdef AIRBRIDGE_RAW_RATE_1M
    constexpr auto raw_rate=WIFI_PHY_RATE_1M_L;
#else
    constexpr auto raw_rate=WIFI_PHY_RATE_6M;
#endif
    if(!check(esp_wifi_set_mac(WIFI_IF_STA,identity.data()),"radio_identity") ||
       !check(esp_wifi_config_80211_tx_rate(WIFI_IF_STA,raw_rate),"raw_rate")) return;
    std::printf("{\"event\":\"raw_rate\",\"sdk_rate\":%d}\n",int(raw_rate));
    airbridge_set_tx_identity(identity.data());
#endif
    if(!check(esp_wifi_start(),"wifi_start") ||
       !check(esp_wifi_set_ps(WIFI_PS_NONE),"wifi_power_save") || !check(esp_wifi_set_channel(6,WIFI_SECOND_CHAN_NONE),"channel")) return;
    std::int8_t power=0;esp_wifi_get_max_tx_power(&power);
    std::printf("{\"event\":\"radio_power\",\"quarter_dbm_ceiling\":%d,\"calibration_mode\":%d}\n",int(power),CONFIG_ESP_PHY_CALIBRATION_MODE);
    wifi_promiscuous_filter_t filter{};filter.filter_mask=WIFI_PROMIS_FILTER_MASK_MGMT;
#ifdef AIRBRIDGE_IPV6_LINK
    filter.filter_mask|=WIFI_PROMIS_FILTER_MASK_DATA;
#endif
    if(!check(esp_wifi_set_promiscuous_filter(&filter),"filter") || !check(esp_wifi_set_promiscuous_rx_cb(on_frame),"callback") ||
       !check(esp_wifi_set_promiscuous(true),"monitor")) return;
    Mac own{};esp_wifi_get_mac(WIFI_IF_STA,own.data());
    std::printf("{\"event\":\"radio_identity\",\"mac\":");print_mac(own);std::printf("}\n");
#ifdef AIRBRIDGE_IPV6_LINK
    if(!check(ipv6_link_begin(own),"awdl_netif")) return;
#endif
#ifdef AIRBRIDGE_NATIVE_SERVICE
    const Mac permitted_peer{AIRBRIDGE_PROBE_PEER_BYTES};
    if(!check(native_receiver_begin(own,permitted_peer),"native_receiver")) return;
#endif
    std::printf("{\"event\":\"scanner_ready\",\"channel\":6,\"native_transfer_verified\":false}\n");
    // The 12-row table must not consume the default 3584-byte app_main stack.
    static PeerTable peers;
    static Observation observation{};
    std::int64_t next=0;
#ifdef AIRBRIDGE_DISCOVER_PROBE
    const Mac probe_target{AIRBRIDGE_PROBE_PEER_BYTES};
    unsigned probe_attempts=0;bool probe_complete=false;std::int64_t next_probe=0;
    static DiscoveryResult probe_result{};
#endif
#ifdef AIRBRIDGE_PRESENCE_TX
    static Presence presence{};
    static ManagementFrame frame{};
    presence.source=own;presence.destination.fill(255);presence.root=presence.parent=own;
    std::copy_n("airbridge-native",16,presence.host_label.begin());
    presence.advertised.channel.fill(6);presence.advertised.slot_aw_count=4;
    presence.self_metric=presence.root_metric=32;presence.self_counter=presence.root_counter=1;
    presence.clock.observe({own,64,0,16,4},std::uint64_t(esp_timer_get_time()));
    std::int64_t next_presence=0,next_direct_presence=0;std::uint16_t sequence=0;unsigned presence_ok=0,presence_failed=0;
#endif
    for(;;) {
        if(xQueueReceive(observations,&observation,pdMS_TO_TICKS(5))==pdTRUE && observation.announcement.source!=own)
            peers.update(observation.announcement,observation.rssi,observation.received);
        const auto now=esp_timer_get_time();
#ifdef AIRBRIDGE_IPV6_LINK
        ipv6_link_poll(peers,std::uint64_t(now));
#endif
#ifdef AIRBRIDGE_DISCOVER_PROBE
        if(discovery_probe_poll(probe_result)) {
#ifdef AIRBRIDGE_NATIVE_SERVICE
            const bool output_locked=serial_diagnostic_lock(5);
            if(output_locked) {
#endif
            flockfile(stdout);
            std::printf("{\"event\":\"peer_identity\",\"mac\":");print_mac(probe_result.peer);
            std::printf(",\"display_name\":");print_string(probe_result.identity.name.data());
            std::printf(",\"model\":");print_string(probe_result.identity.model.data());
            std::printf(",\"name_source\":\"airdrop_discover\",\"http_status\":%u,\"error\":%d,\"stage\":",probe_result.http_status,probe_result.error);print_string(probe_result.stage.data());
            std::printf(",\"has_airdropable\":%s,\"airdropable\":%s}\n",probe_result.identity.has_airdropable?"true":"false",probe_result.identity.airdropable?"true":"false");
            if(!probe_result.error) probe_complete=true;
            funlockfile(stdout);
#ifdef AIRBRIDGE_NATIVE_SERVICE
                serial_diagnostic_unlock();
            }
#endif
        }
        if(!probe_complete && probe_attempts<3 && now>=next_probe) {
            for(const auto& peer:peers.rows()) if(peer.used && peer.announcement.source==probe_target && peer.announcement.service.airdrop && peer.announcement.service.port &&
               std::uint64_t(now)>=peer.service_received_us && std::uint64_t(now)-peer.service_received_us<10'000'000) {
                if(discovery_probe_start(probe_target,peer.announcement.service.port)) {++probe_attempts;next_probe=now+15'000'000;}
                break;
            }
        }
#endif
#ifdef AIRBRIDGE_PRESENCE_TX
        if(const auto* selected=peers.select(own,std::uint64_t(now))) {
            const auto& info=selected->announcement;
            presence.root=info.election.root;presence.parent=info.source;presence.depth=info.election.depth+1;
            presence.root_metric=info.election.root_metric;presence.root_counter=info.election.root_counter;
            presence.clock.observe(info.sync,selected->sync_received_us);
        }
        if(now>=next_presence) {
            next_presence=now+55'000;
            for(const auto kind: {0,3}) {
                const auto encoded=encode_presence(presence,std::uint8_t(kind),sequence++,std::uint64_t(now),frame);
                const auto sent=encoded==Error::none ? esp_wifi_80211_tx(WIFI_IF_STA,frame.bytes.data(),int(frame.length),true) : ESP_ERR_INVALID_ARG;
                if(sent==ESP_OK) ++presence_ok;else ++presence_failed;
            }
        }
#ifdef AIRBRIDGE_DISCOVER_PROBE
        // A directed announcement pair can use the peer's actual channel-6
        // window and Wi-Fi acknowledgement/retries. Broadcast-only presence
        // must not be assumed to keep Apple's unicast neighbor state alive.
        if(now>=next_direct_presence) for(const auto& peer:peers.rows()) {
            if(!peer.used || peer.announcement.source!=probe_target || !peer.announcement.has_sync ||
               !peer.announcement.has_channels || std::uint64_t(now)<peer.sync_received_us ||
               std::uint64_t(now)-peer.sync_received_us>3'000'000) continue;
            Clock peer_clock;
            if(!peer_clock.observe(peer.announcement.sync,peer.sync_received_us) ||
               peer.announcement.channels.channel[peer_clock.slot(std::uint64_t(now))]!=6) break;
            presence.destination=probe_target;next_direct_presence=now+500'000;
            for(const auto kind: {0,3}) {
                const auto encoded=encode_presence(presence,std::uint8_t(kind),sequence++,std::uint64_t(now),frame);
                const auto sent=encoded==Error::none ? esp_wifi_80211_tx(WIFI_IF_STA,frame.bytes.data(),int(frame.length),true) : ESP_ERR_INVALID_ARG;
                if(sent==ESP_OK) ++presence_ok;else ++presence_failed;
            }
            presence.destination.fill(255);break;
        }
#endif
#endif
        if(now<next) continue;
        next=now+1'000'000;
#ifdef AIRBRIDGE_NATIVE_SERVICE
        if(!serial_diagnostic_lock()) continue;
#endif
        flockfile(stdout);
#ifdef AIRBRIDGE_SCAN_CAPTURE
        if(sample_state.load(std::memory_order_acquire)>=2) {
            std::printf("{\"event\":\"first_rejected_sample\",\"hex\":\"");
            for(std::size_t i=0;i<sample_length;i++) std::printf("%02x",sample[i]);
            std::printf("\"}\n");sample_state.store(3);
        }
#endif
        std::printf("{\"event\":\"decode_errors\",\"truncated\":%u,\"malformed\":%u,\"unsupported\":%u,\"duplicate\":%u}\n",failures[2].load(),failures[3].load(),failures[4].load(),failures[5].load());
        std::printf("{\"event\":\"scanner_status\",\"accepted\":%u,\"malformed\":%u,\"queue_full\":%u,\"peers\":[",accepted.load(),malformed.load(),queue_full.load());
        bool comma=false;
        for(const auto& peer:peers.rows()) {
            if(!peer.used || std::uint64_t(now)<peer.seen_us || std::uint64_t(now)-peer.seen_us>10'000'000) continue;
            if(comma) std::putchar(',');
            comma=true;
            std::printf("{\"mac\":");print_mac(peer.announcement.source);
            std::printf(",\"rssi\":%d,\"host_label\":",int(peer.rssi));print_string(peer.announcement.hostname.data());
            std::printf(",\"airdrop_advertised\":%s,\"airdrop_port\":%u,\"service_instance\":",peer.announcement.service.airdrop?"true":"false",peer.announcement.service.port);
            print_string(peer.announcement.service.instance.data());
            std::printf(",\"name_source\":\"awdl_arpa\",\"channel6_mask\":%u,\"root_metric\":%lu,\"has_sync\":%s,\"has_election\":%s}",
                peer.announcement.channels.mask(6),static_cast<unsigned long>(peer.announcement.election.root_metric),
                peer.announcement.has_sync?"true":"false",peer.announcement.has_election?"true":"false");
        }
        std::printf("],\"selected_transmitter\":");
        const auto* selected=peers.select(own,std::uint64_t(now));
        if(selected) print_mac(selected->announcement.source);else std::printf("null");
#ifdef AIRBRIDGE_PRESENCE_TX
        std::printf(",\"presence_tx_admitted\":%u,\"presence_tx_rejected\":%u",presence_ok,presence_failed);
#endif
#ifdef AIRBRIDGE_IPV6_LINK
        const auto link=ipv6_link_counters();
        std::printf(",\"ipv6_rx\":%u,\"ipv6_rx_dropped\":%u,\"ipv6_tx_queued\":%u,\"ipv6_tx_admitted\":%u,\"ipv6_tx_completed\":%u,\"ipv6_tx_failed\":%u,\"ipv6_inflight\":%u",link.rx,link.rx_dropped,link.tx_queued,link.tx_admitted,link.tx_completed,link.tx_failed,link.tx_inflight);
#endif
        std::printf("}\n");std::fflush(stdout);
        funlockfile(stdout);
#ifdef AIRBRIDGE_NATIVE_SERVICE
        serial_diagnostic_unlock();
#endif
    }
}
