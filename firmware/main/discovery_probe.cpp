// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "discovery_probe.hpp"
#include "ipv6_link.hpp"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "lwip/sockets.h"
#include "lwip/inet.h"
#include "mbedtls/ssl.h"
#include "psa/crypto.h"
#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>
using namespace airbridge;
namespace {
struct Endpoint {awdl::Mac peer{};std::uint16_t port{};};
Endpoint endpoint{};
std::atomic<bool> busy{};
QueueHandle_t results;
std::array<std::uint8_t,24576> wire{};

int send_bytes(void* context,const unsigned char* bytes,std::size_t count) {
    const int fd=*static_cast<int*>(context);
    const int result=int(send(fd,bytes,count,0));
    if(result>=0) return result;
    return errno==EAGAIN || errno==EWOULDBLOCK ? MBEDTLS_ERR_SSL_WANT_WRITE : MBEDTLS_ERR_SSL_INTERNAL_ERROR;
}
int receive_bytes(void* context,unsigned char* bytes,std::size_t count) {
    const int fd=*static_cast<int*>(context);
    const int result=int(recv(fd,bytes,count,0));
    if(result>=0) return result;
    return errno==EAGAIN || errno==EWOULDBLOCK ? MBEDTLS_ERR_SSL_WANT_READ : MBEDTLS_ERR_SSL_INTERNAL_ERROR;
}
bool retry(int result) {return result==MBEDTLS_ERR_SSL_WANT_READ || result==MBEDTLS_ERR_SSL_WANT_WRITE;}
void stage(DiscoveryResult& result,const char* value) {std::snprintf(result.stage.data(),result.stage.size(),"%s",value);}

void worker(void*) {
    DiscoveryResult result{};result.peer=endpoint.peer;
    mbedtls_ssl_context tls;mbedtls_ssl_config config;
    mbedtls_ssl_init(&tls);mbedtls_ssl_config_init(&config);
    int fd=-1;
    auto perform=[&]() -> int {
        stage(result,"psa_init");if(psa_crypto_init()!=PSA_SUCCESS) return -1;
        stage(result,"tls_config");
        int rc=mbedtls_ssl_config_defaults(&config,MBEDTLS_SSL_IS_CLIENT,MBEDTLS_SSL_TRANSPORT_STREAM,MBEDTLS_SSL_PRESET_DEFAULT);
        if(rc) return rc;
        // Everyone-mode AirDrop discovery does not authenticate a contact identity.
        mbedtls_ssl_conf_authmode(&config,MBEDTLS_SSL_VERIFY_NONE);
        mbedtls_ssl_conf_min_tls_version(&config,MBEDTLS_SSL_VERSION_TLS1_2);
        mbedtls_ssl_conf_max_tls_version(&config,MBEDTLS_SSL_VERSION_TLS1_2);
        if((rc=mbedtls_ssl_setup(&tls,&config))) return rc;
        stage(result,"tcp_connect");fd=socket(AF_INET6,SOCK_STREAM,0);if(fd<0) return -errno;
        const int flags=fcntl(fd,F_GETFL,0);if(flags<0 || fcntl(fd,F_SETFL,flags|O_NONBLOCK)<0) return -errno;
        sockaddr_in6 address{};address.sin6_family=AF_INET6;address.sin6_port=htons(endpoint.port);address.sin6_scope_id=std::uint32_t(ipv6_link_index());
        const auto target=awdl::link_local(endpoint.peer);std::memcpy(&address.sin6_addr,target.data(),target.size());
        rc=connect(fd,reinterpret_cast<sockaddr*>(&address),sizeof(address));
        if(rc<0) {
            if(errno!=EINPROGRESS && errno!=EWOULDBLOCK) return -errno;
            fd_set writes;FD_ZERO(&writes);FD_SET(fd,&writes);timeval timeout{5,0};
            rc=select(fd+1,nullptr,&writes,nullptr,&timeout);
            if(rc<=0) return rc==0 ? -ETIMEDOUT : -errno;
            int error=0;socklen_t size=sizeof(error);
            if(getsockopt(fd,SOL_SOCKET,SO_ERROR,&error,&size)<0) return -errno;
            if(error) return -error;
        }
        mbedtls_ssl_set_bio(&tls,&fd,send_bytes,receive_bytes,nullptr);
        stage(result,"tls_handshake");
        auto deadline=esp_timer_get_time()+20'000'000;
        do {
            rc=mbedtls_ssl_handshake(&tls);
            if(!rc) break;
            if(!retry(rc)) return rc;
            if(esp_timer_get_time()>deadline) return -ETIMEDOUT;
            vTaskDelay(pdMS_TO_TICKS(2));
        } while(true);
        stage(result,"discover_write");
        const auto body=discovery::discover_request(111611);
        std::array<std::uint8_t,512> request{};
        const int header=std::snprintf(reinterpret_cast<char*>(request.data()),request.size(),
            "POST /Discover HTTP/1.1\r\nUser-Agent: AirDrop/1.0\r\nConnection: close\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n\r\n%X\r\n",unsigned(body.size()));
        if(header<=0 || std::size_t(header)+body.size()+7>request.size()) return -EINVAL;
        std::memcpy(request.data()+header,body.data(),body.size());
        std::memcpy(request.data()+header+body.size(),"\r\n0\r\n\r\n",7);
        const std::size_t count=std::size_t(header)+body.size()+7;
        std::size_t sent=0;deadline=esp_timer_get_time()+15'000'000;
        while(sent<count) {
            rc=mbedtls_ssl_write(&tls,request.data()+sent,count-sent);
            if(rc>0) sent+=std::size_t(rc);
            else if(!retry(rc)) return rc ? rc : -EPIPE;
            if(esp_timer_get_time()>deadline) return -ETIMEDOUT;
            vTaskDelay(pdMS_TO_TICKS(2));
        }
        stage(result,"discover_read");std::size_t used=0;deadline=esp_timer_get_time()+15'000'000;
        while(used<wire.size()) {
            rc=mbedtls_ssl_read(&tls,wire.data()+used,wire.size()-used);
            bool eof=false;
            if(rc>0) used+=std::size_t(rc);
            else if(!rc || rc==MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY || rc==MBEDTLS_ERR_SSL_CONN_EOF) eof=true;
            else if(!retry(rc)) return rc;
            discovery::HttpResponse response{};
            const auto parsed=discovery::parse_http_response(wire.data(),used,response,eof);
            if(parsed==awdl::Error::none) {
                result.http_status=response.status;
                if(response.status<200 || response.status>=300) return -EPROTO;
                stage(result,"discover_plist");
                const auto decoded=discovery::parse_identity_plist(response.body,result.identity);
                if(decoded!=awdl::Error::none) return -1000-int(decoded);
                stage(result,"complete");return 0;
            }
            if(parsed!=awdl::Error::truncated || eof) return -2000-int(parsed);
            if(esp_timer_get_time()>deadline) return -ETIMEDOUT;
            vTaskDelay(pdMS_TO_TICKS(2));
        }
        return -EMSGSIZE;
    };
    result.error=perform();
    if(fd>=0) {mbedtls_ssl_close_notify(&tls);close(fd);}
    mbedtls_ssl_free(&tls);mbedtls_ssl_config_free(&config);
    xQueueSend(results,&result,0);busy.store(false,std::memory_order_release);vTaskDelete(nullptr);
}
}

bool discovery_probe_start(const awdl::Mac& peer,std::uint16_t port) {
    if(!port) return false;
    bool expected=false;if(!busy.compare_exchange_strong(expected,true)) return false;
    if(!results) results=xQueueCreate(4,sizeof(DiscoveryResult));
    if(!results) {busy=false;return false;}
    endpoint={peer,port};
    if(xTaskCreatePinnedToCore(worker,"ad_discover",16384,nullptr,1,nullptr,1)!=pdPASS) {busy=false;return false;}
    return true;
}
bool discovery_probe_poll(DiscoveryResult& result) {return results && xQueueReceive(results,&result,0)==pdTRUE;}
