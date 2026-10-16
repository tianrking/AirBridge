// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "ipv6_link.hpp"
#include "presence.hpp"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "lwip/netif.h"
#include "lwip/tcpip.h"
#include "lwip/pbuf.h"
#include "lwip/udp.h"
#include <algorithm>
#include <atomic>
#include <cstring>
using namespace airbridge::awdl;
namespace {
struct Packet {std::array<std::uint8_t,1280> bytes{};std::uint16_t length{};Mac destination{};};
enum class Ownership {free,queued,inflight};
struct Slot {Packet packet{};Ownership owner{};std::uint16_t sequence{};std::uint64_t queued_us{};};
std::array<Slot,16> outgoing{};
Mac identity{};
netif interface{};
QueueHandle_t incoming;
SemaphoreHandle_t initialized;
portMUX_TYPE lock=portMUX_INITIALIZER_UNLOCKED;
LinkCounters counters{};
std::atomic<bool> ready{};
std::uint16_t sequence{};

err_t output_ip6(netif*,pbuf* data,const ip6_addr_t* address) {
    if(!data || data->tot_len<40 || data->tot_len>1280) return ERR_VAL;
    const auto* ip=reinterpret_cast<const std::uint8_t*>(address->addr);Mac target{};
    if(ip[0]==0xff) target={0x33,0x33,ip[12],ip[13],ip[14],ip[15]};
    else if(ip[0]==0xfe && ip[1]==0x80 && ip[11]==0xff && ip[12]==0xfe) target={std::uint8_t(ip[8]^2),ip[9],ip[10],ip[13],ip[14],ip[15]};
    else return ERR_RTE;
    portENTER_CRITICAL(&lock);
    Slot* slot=nullptr;
    for(auto& value:outgoing) if(value.owner==Ownership::free) {slot=&value;break;}
    if(!slot) {portEXIT_CRITICAL(&lock);return ERR_MEM;}
    slot->packet.length=data->tot_len;slot->packet.destination=target;
    const auto copied=pbuf_copy_partial(data,slot->packet.bytes.data(),data->tot_len,0);
    if(copied!=data->tot_len) {portEXIT_CRITICAL(&lock);return ERR_VAL;}
    slot->sequence=sequence++;slot->queued_us=std::uint64_t(esp_timer_get_time());slot->owner=Ownership::queued;
    ++counters.tx_queued;portEXIT_CRITICAL(&lock);return ERR_OK;
}

err_t initialize(netif* value) {
    value->name[0]='a';value->name[1]='w';value->mtu=1280;value->hwaddr_len=6;
    std::copy(identity.begin(),identity.end(),value->hwaddr);
    value->output_ip6=output_ip6;value->flags=NETIF_FLAG_MLD6;
    return ERR_OK;
}
void on_tcpip_thread(void*) {
    if(netif_add_noaddr(&interface,nullptr,initialize,tcpip_input)) {
        netif_create_ip6_linklocal_address(&interface,1);
        netif_ip6_addr_set_state(&interface,0,IP6_ADDR_PREFERRED);
        netif_set_default(&interface);netif_set_up(&interface);netif_set_link_up(&interface);
        // Diagnostic data-plane endpoint; this is not an AirDrop file service.
        auto* echo=udp_new_ip_type(IPADDR_TYPE_V6);
        if(echo && udp_bind(echo,IP6_ADDR_ANY,8779)==ERR_OK) {
            udp_recv(echo,[](void*,udp_pcb* pcb,pbuf* payload,const ip_addr_t* source,u16_t port) {
                if(payload) {udp_sendto(pcb,payload,source,port);pbuf_free(payload);}
            },nullptr);
        } else if(echo) udp_remove(echo);
        ready=true;
    }
    xSemaphoreGive(initialized);
}

void completed(const esp_80211_tx_info_t* info) {
    if(!info || info->ifidx!=WIFI_IF_STA || !info->data) return;
    const auto* frame=info->data;
    if(frame[0]!=0x88 || std::memcmp(frame+10,identity.data(),6)) return;
    constexpr std::uint8_t prefix[]={0xaa,0xaa,3,0,0x17,0xf2,8,0,3,4};
    if(std::memcmp(frame+26,prefix,sizeof(prefix))) return;
    // The SDK's data_len is uint8_t and cannot describe a full IPv6 MTU. Read
    // only the fixed header of our own submitted frames, then match ownership.
    const auto completed_sequence=std::uint16_t(unsigned(frame[36]) | unsigned(frame[37])<<8);
    portENTER_CRITICAL(&lock);
    for(auto& slot:outgoing) if(slot.owner==Ownership::inflight && slot.sequence==completed_sequence) {
        slot.owner=Ownership::free;
        if(counters.tx_inflight) --counters.tx_inflight;
        if(info->tx_status==WIFI_SEND_SUCCESS) ++counters.tx_completed;else ++counters.tx_failed;
        break;
    }
    portEXIT_CRITICAL(&lock);
    // Multicast completion releases ownership too. TCP owns unicast retransmission.
}
}

esp_err_t ipv6_link_begin(const Mac& own) {
    if(ready) return ESP_OK;
    identity=own;incoming=xQueueCreate(16,sizeof(Packet));initialized=xSemaphoreCreateBinary();
    if(!incoming || !initialized) return ESP_ERR_NO_MEM;
    if(tcpip_callback(on_tcpip_thread,nullptr)!=ERR_OK || xSemaphoreTake(initialized,pdMS_TO_TICKS(5000))!=pdTRUE || !ready) return ESP_FAIL;
    return esp_wifi_register_80211_tx_cb(completed);
}
void ipv6_link_receive(const Ipv6Frame& frame) {
    if(!ready || frame.packet.size>1280 || (!(frame.destination[0]&1) && frame.destination!=identity)) return;
    Packet packet{};packet.length=std::uint16_t(frame.packet.size);std::copy_n(frame.packet.data,frame.packet.size,packet.bytes.begin());
    if(xQueueSend(incoming,&packet,0)!=pdTRUE) {portENTER_CRITICAL(&lock);++counters.rx_dropped;portEXIT_CRITICAL(&lock);}
}
void ipv6_link_poll(const PeerTable& peers,std::uint64_t now) {
    static Packet received{};
    for(unsigned budget=0;budget<8 && xQueueReceive(incoming,&received,0)==pdTRUE;budget++) {
        auto* packet=pbuf_alloc(PBUF_RAW,received.length,PBUF_RAM);
        if(!packet || pbuf_take(packet,received.bytes.data(),received.length)!=ERR_OK) {
            if(packet) pbuf_free(packet);
            portENTER_CRITICAL(&lock);++counters.rx_dropped;portEXIT_CRITICAL(&lock);continue;
        }
        if(interface.input(packet,&interface)!=ERR_OK) pbuf_free(packet);
        else {portENTER_CRITICAL(&lock);++counters.rx;portEXIT_CRITICAL(&lock);}
    }
    static DataFrame encoded{};
    for(auto& slot:outgoing) {
        portENTER_CRITICAL(&lock);
        if(slot.owner==Ownership::free) {portEXIT_CRITICAL(&lock);continue;}
        if(now>=slot.queued_us && now-slot.queued_us>5'000'000) {
            if(slot.owner==Ownership::inflight && counters.tx_inflight) --counters.tx_inflight;
            slot.owner=Ownership::free;++counters.tx_failed;portEXIT_CRITICAL(&lock);continue;
        }
        if(slot.owner!=Ownership::queued) {portEXIT_CRITICAL(&lock);continue;}
        portEXIT_CRITICAL(&lock);
        bool available=bool(slot.packet.destination[0]&1);
        if(!available) for(const auto& peer:peers.rows()) {
            if(!peer.used || peer.announcement.source!=slot.packet.destination || !peer.announcement.has_sync ||
               !peer.announcement.has_channels || now<peer.sync_received_us || now-peer.sync_received_us>3'000'000) continue;
            Clock clock;
            if(clock.observe(peer.announcement.sync,peer.sync_received_us))
                available=peer.announcement.channels.channel[clock.slot(now)]==6;
            break;
        }
        if(!available) continue;
        const auto result=encode_ipv6(identity,slot.packet.destination,slot.sequence,slot.sequence,{slot.packet.bytes.data(),slot.packet.length},encoded);
        portENTER_CRITICAL(&lock);slot.owner=Ownership::inflight;++counters.tx_inflight;portEXIT_CRITICAL(&lock);
        const auto error=result==Error::none ? esp_wifi_80211_tx(WIFI_IF_STA,encoded.bytes.data(),int(encoded.length),true) : ESP_ERR_INVALID_ARG;
        portENTER_CRITICAL(&lock);
        if(error==ESP_OK) ++counters.tx_admitted;
        else {slot.owner=Ownership::queued;if(counters.tx_inflight) --counters.tx_inflight;}
        portEXIT_CRITICAL(&lock);
        break; // one bounded driver submission per controller pass
    }
}
LinkCounters ipv6_link_counters() {portENTER_CRITICAL(&lock);const auto value=counters;portEXIT_CRITICAL(&lock);return value;}
unsigned ipv6_link_index() {return ready ? netif_get_index(&interface) : 0;}
