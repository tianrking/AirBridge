// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "native_receiver.hpp"
#include "serial_channel.hpp"
#include <cstdarg>
#include "native_service.hpp"
#include "ipv6_link.hpp"
#include "identity_credentials.hpp"
#include "esp_timer.h"
#include "esp_random.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "lwip/inet.h"
#include "mbedtls/ssl.h"
#include "mbedtls/x509_crt.h"
#include "mbedtls/pk.h"
#include "mbedtls/base64.h"
#include "miniz.h"
#include "psa/crypto.h"
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <new>
#include <unistd.h>
using namespace airbridge;
namespace {
awdl::Mac identity{},allowed{};
std::atomic<bool> listening{},host_committed{};
portMUX_TYPE commit_lock=portMUX_INITIALIZER_UNLOCKED;
std::array<char,33> commit_nonce{};
std::array<char,65> chunk_id{};
unsigned chunk_index{};std::uint32_t chunk_offset{};std::atomic<bool> chunk_received{};
bool record(const char* format,...) {
    std::array<char,1024> line{};va_list args;va_start(args,format);
    const int length=std::vsnprintf(line.data(),line.size(),format,args);va_end(args);
    return length>0 && std::size_t(length)<line.size() && serial_record(line.data(),std::size_t(length));
}
void event(const char* name,int code=0) {record("{\"event\":\"%s\",\"code\":%d}\n",name,code);}
void hex(const unsigned char* input,std::size_t length,char* output) {
    constexpr char digits[]="0123456789abcdef";
    for(std::size_t i=0;i<length;i++) {output[i*2]=digits[input[i]>>4];output[i*2+1]=digits[input[i]&15];}output[length*2]=0;
}
bool again(int code) {return code==MBEDTLS_ERR_SSL_WANT_READ || code==MBEDTLS_ERR_SSL_WANT_WRITE;}
int send_tls(void* p,const unsigned char* data,std::size_t count) {const int rc=int(send(*static_cast<int*>(p),data,count,0));return rc>=0 ? rc : errno==EAGAIN || errno==EWOULDBLOCK ? MBEDTLS_ERR_SSL_WANT_WRITE : MBEDTLS_ERR_SSL_INTERNAL_ERROR;}
int recv_tls(void* p,unsigned char* data,std::size_t count) {const int rc=int(recv(*static_cast<int*>(p),data,count,0));return rc>=0 ? rc : errno==EAGAIN || errno==EWOULDBLOCK ? MBEDTLS_ERR_SSL_WANT_READ : MBEDTLS_ERR_SSL_INTERNAL_ERROR;}
struct Channel {
    mbedtls_ssl_context* tls;
    std::array<std::uint8_t,2048> bytes{};std::size_t at{},used{};
    bool write(awdl::Bytes input) {
        std::size_t sent=0;const auto deadline=esp_timer_get_time()+30'000'000;
        while(sent<input.size) {const int rc=mbedtls_ssl_write(tls,input.data+sent,input.size-sent);
            if(rc>0) sent+=std::size_t(rc);else if(!again(rc)) return false;
            if(esp_timer_get_time()>deadline) return false;
            vTaskDelay(pdMS_TO_TICKS(1));
        }return true;
    }
    bool write_text(const char* text) {return write({reinterpret_cast<const std::uint8_t*>(text),std::strlen(text)});}
    bool fill(std::int64_t deadline) {
        if(at<used) return true;
        at=used=0;
        while(esp_timer_get_time()<deadline) {const int rc=mbedtls_ssl_read(tls,bytes.data(),bytes.size());
            if(rc>0) {used=std::size_t(rc);return true;}if(!again(rc)) return false;vTaskDelay(pdMS_TO_TICKS(2));
        }return false;
    }
    bool headers(native::Request& request) {
        std::array<std::uint8_t,8192> header{};std::size_t size=0;const auto deadline=esp_timer_get_time()+30'000'000;
        while(size<header.size()) {if(!fill(deadline)) return false;header[size++]=bytes[at++];
            if(size>=4 && !std::memcmp(header.data()+size-4,"\r\n\r\n",4)) return native::parse_request({header.data(),size},request)==awdl::Error::none;
        }return false;
    }
    bool body(const native::Request& request,transfer::Emit emit,void* context) {
        native::BodyDecoder decoder(request,emit,context);auto deadline=esp_timer_get_time()+30'000'000;
        if(request.expect_continue && !write_text("HTTP/1.1 100 Continue\r\n\r\n")) return false;
        while(!decoder.complete()) {if(!fill(deadline)) return false;std::size_t consumed=0;
            if(decoder.feed({bytes.data()+at,used-at},consumed)!=awdl::Error::none || !consumed) return false;
            at+=consumed;deadline=esp_timer_get_time()+30'000'000;
        }return true;
    }
    bool response(unsigned status,const char* body,bool close=false) {
        std::array<char,256> header{};const auto length=std::strlen(body);
        const int count=std::snprintf(header.data(),header.size(),"HTTP/1.1 %u %s\r\nContent-Type: application/octet-stream\r\nContent-Length: %u\r\nConnection: %s\r\n\r\n",status,status==200 ? "OK" : "Rejected",unsigned(length),close ? "close" : "keep-alive");
        return count>0 && std::size_t(count)<header.size() && write({reinterpret_cast<const std::uint8_t*>(header.data()),std::size_t(count)}) && write_text(body);
    }
};
constexpr const char discover[]="<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"><plist version=\"1.0\"><dict><key>ReceiverComputerName</key><string>AirBridge PC</string><key>ReceiverModelName</key><string>Windows</string><key>IsAirDropable</key><true/><key>DeviceSupportFlags</key><integer>111611</integer></dict></plist>";
constexpr const char accepted[]="<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>ReceiverComputerName</key><string>AirBridge PC</string><key>ReceiverModelName</key><string>Windows</string></dict></plist>";
struct Session {
    native::AskManifest manifest{};
    std::array<bool,32> finished{};
    unsigned active{},sidecars{};std::uint32_t offset{},active_size{};std::uint64_t metadata_bytes{};bool in_file{},pending{};
    std::int64_t expires{};
    psa_hash_operation_t hash=PSA_HASH_OPERATION_INIT;
    ~Session() {psa_hash_abort(&hash);}
};
bool begin_file(void* p,const char* name,std::uint32_t size) {
    auto& session=*static_cast<Session*>(p);
    if(session.in_file) return false;
    for(unsigned pass=0;pass<2;pass++) for(unsigned i=0;i<session.manifest.count;i++) {
        const auto& offer=session.manifest.files[i];const bool regular=pass==0 && !std::strcmp(offer.name.data(),name);
        const bool metadata=pass==1 && !std::strncmp(name,"._",2) && !std::strcmp(offer.name.data(),name+2);
        if(!regular && !metadata) continue;
        const auto index=metadata ? i+16 : i;
        if(session.finished[index] || (regular && offer.size!=size) || psa_hash_setup(&session.hash,PSA_ALG_SHA_256)!=PSA_SUCCESS) return false;
        session.active=index;session.active_size=size;session.offset=0;session.in_file=true;
        if(metadata) {++session.sidecars;session.metadata_bytes+=size;}
        std::array<unsigned char,344> encoded{};std::size_t length=0;
        if(mbedtls_base64_encode(encoded.data(),encoded.size(),&length,reinterpret_cast<const unsigned char*>(name),std::strlen(name))) return false;
        return record("{\"event\":\"file_begin\",\"index\":%u,\"name_b64\":\"%s\",\"size\":%lu,\"metadata\":%s}\n",index,encoded.data(),static_cast<unsigned long>(size),metadata ? "true" : "false");
    }return false;
}
bool write_file(void* p,awdl::Bytes input) {
    auto& session=*static_cast<Session*>(p);
    if(!session.in_file || input.size>session.active_size-session.offset || psa_hash_update(&session.hash,input.data,input.size)!=PSA_SUCCESS) return false;
    std::size_t at=0;
    while(at<input.size) {
        const auto count=std::min(std::size_t{512},input.size-at);std::array<unsigned char,688> encoded{};std::size_t length=0;
        if(mbedtls_base64_encode(encoded.data(),encoded.size(),&length,input.data+at,count)) return false;
        portENTER_CRITICAL(&commit_lock);chunk_id=session.manifest.transfer_id;chunk_index=session.active;chunk_offset=session.offset+std::uint32_t(count);chunk_received=false;portEXIT_CRITICAL(&commit_lock);
        if(!record("{\"event\":\"file_chunk\",\"index\":%u,\"offset\":%lu,\"data\":\"%s\"}\n",session.active,static_cast<unsigned long>(session.offset),encoded.data())) return false;
        const auto deadline=esp_timer_get_time()+5'000'000;
        while(!chunk_received && esp_timer_get_time()<deadline) vTaskDelay(pdMS_TO_TICKS(1));
        portENTER_CRITICAL(&commit_lock);chunk_id.fill(0);portEXIT_CRITICAL(&commit_lock);
        if(!chunk_received) return false;
        at+=count;session.offset+=std::uint32_t(count);
    }return true;
}
bool end_file(void* p) {
    auto& session=*static_cast<Session*>(p);std::array<unsigned char,32> hash{};std::size_t count=0;std::array<char,65> digest{};
    if(!session.in_file || session.offset!=session.active_size || psa_hash_finish(&session.hash,hash.data(),hash.size(),&count)!=PSA_SUCCESS || count!=32) return false;
    hex(hash.data(),hash.size(),digest.data());session.in_file=false;session.finished[session.active]=true;
    return record("{\"event\":\"file_end\",\"index\":%u,\"bytes\":%lu,\"sha256\":\"%s\"}\n",session.active,static_cast<unsigned long>(session.offset),digest.data());
}
bool inflate_block(void*,awdl::Bytes input,std::uint8_t* output,std::size_t capacity,std::size_t& size) {
    size=tinfl_decompress_mem_to_mem(output,capacity,input.data,input.size,TINFL_FLAG_PARSE_ZLIB_HEADER);
    return size!=TINFL_DECOMPRESS_MEM_TO_MEM_FAILED;
}
void commands(void*) {
    std::array<char,128> line{};
    for(;;) {
        if(std::fgets(line.data(),int(line.size()),stdin)) {
            auto* end=std::strpbrk(line.data(),"\r\n");if(end) *end=0;
            if(!std::strncmp(line.data(),"COMMIT ",7)) {
                portENTER_CRITICAL(&commit_lock);
                if(commit_nonce[0] && !std::strcmp(line.data()+7,commit_nonce.data())) host_committed=true;
                portEXIT_CRITICAL(&commit_lock);
            } else if(!std::strncmp(line.data(),"CHUNK ",6)) {
                std::array<char,65> id{};unsigned index=0;unsigned long offset=0;char extra=0;
                if(std::sscanf(line.data()+6,"%64s %u %lu %c",id.data(),&index,&offset,&extra)==3) {
                    portENTER_CRITICAL(&commit_lock);
                    if(chunk_id[0] && !std::strcmp(id.data(),chunk_id.data()) && index==chunk_index && offset==chunk_offset) chunk_received=true;
                    portEXIT_CRITICAL(&commit_lock);
                }
            }
        } else {std::clearerr(stdin);vTaskDelay(pdMS_TO_TICKS(20));}
    }
}
void serve_client(mbedtls_ssl_context& tls,Session& session,std::uint8_t* body,std::uint8_t* compressed,std::uint8_t* expanded) {
    Channel channel{&tls};
    for(unsigned requests=0;requests<8;requests++) {
        native::Request request{};if(!channel.headers(request)) return;
        const bool supported=!std::strcmp(request.path.data(),"/Discover") || !std::strcmp(request.path.data(),"/Ask") || !std::strcmp(request.path.data(),"/Upload");
        record("{\"event\":\"native_request\",\"path\":\"%s\"}\n",supported ? request.path.data() : "<unsupported>");
        if(!std::strcmp(request.path.data(),"/Discover") || !std::strcmp(request.path.data(),"/Ask")) {
            struct Buffer {std::uint8_t* data;std::size_t used{};} buffer{body};
            const bool read=channel.body(request,[](void* p,awdl::Bytes bytes){auto& b=*static_cast<Buffer*>(p);if(bytes.size>131072-b.used) return false;std::memcpy(b.data+b.used,bytes.data,bytes.size);b.used+=bytes.size;return true;},&buffer);
            if(!read) {channel.response(400,"",true);return;}
            if(!std::strcmp(request.path.data(),"/Discover")) {channel.response(200,discover,true);return;}
            if(session.pending && esp_timer_get_time()<session.expires) {channel.response(409,"",true);return;}
            native::AskManifest manifest{};
            const auto parsed=native::parse_ask({body,buffer.used},manifest);
            if(parsed!=awdl::Error::none) {event("ask_rejected",int(parsed));channel.response(406,"",true);return;}
            session.manifest=manifest;session.finished.fill(false);session.sidecars=0;session.metadata_bytes=0;session.pending=true;session.in_file=false;session.expires=esp_timer_get_time()+120'000'000;
            if(!record("{\"event\":\"transfer_begin\",\"transfer_id\":\"%s\",\"files\":%u,\"total_bytes\":%llu}\n",manifest.transfer_id.data(),manifest.count,static_cast<unsigned long long>(manifest.total))) {session.pending=false;return;}
            for(unsigned i=0;i<manifest.count;i++) {
                std::array<unsigned char,344> name{};std::size_t size=0;const auto& file=manifest.files[i];
                if(mbedtls_base64_encode(name.data(),name.size(),&size,reinterpret_cast<const unsigned char*>(file.name.data()),std::strlen(file.name.data()))) return;
                if(!record("{\"event\":\"manifest_file\",\"index\":%u,\"name_b64\":\"%s\",\"size\":%lu}\n",i,name.data(),static_cast<unsigned long>(file.size))) {session.pending=false;return;}
            }
            if(!channel.response(200,accepted)) return;
        } else if(!std::strcmp(request.path.data(),"/Upload")) {
            if(!session.pending || esp_timer_get_time()>session.expires || std::strcmp(request.transfer_id.data(),session.manifest.transfer_id.data()) ||
               std::strcmp(request.content_type.data(),"application/x-dvzip") || !request.has_total || request.total_bytes!=session.manifest.total) {channel.response(409,"",true);return;}
            auto* archive=new(std::nothrow) transfer::CpioReader({&session,begin_file,write_file,end_file});
            if(!archive) {channel.response(503,"",true);return;}
            transfer::DvZipReader decoder(*archive,compressed,263168,expanded,262144,inflate_block);
            bool okay=channel.body(request,[](void* p,awdl::Bytes bytes){return static_cast<transfer::DvZipReader*>(p)->feed(bytes)==awdl::Error::none;},&decoder);
            okay=okay && decoder.finish()==awdl::Error::none && archive->files()==session.manifest.count+session.sidecars && archive->total_bytes()==session.manifest.total+session.metadata_bytes && !session.in_file;
            delete archive;
            for(unsigned i=0;i<session.manifest.count;i++) okay=okay && session.finished[i];
            if(okay) {
                std::array<std::uint8_t,16> random{};esp_fill_random(random.data(),random.size());std::array<char,33> nonce{};hex(random.data(),random.size(),nonce.data());
                portENTER_CRITICAL(&commit_lock);commit_nonce=nonce;host_committed=false;portEXIT_CRITICAL(&commit_lock);
                const bool requested=record("{\"event\":\"transfer_ready\",\"transfer_id\":\"%s\",\"nonce\":\"%s\",\"files\":%u,\"total_bytes\":%llu}\n",session.manifest.transfer_id.data(),nonce.data(),session.manifest.count+session.sidecars,static_cast<unsigned long long>(session.manifest.total+session.metadata_bytes));
                const auto deadline=esp_timer_get_time()+120'000'000;
                while(requested && !host_committed && esp_timer_get_time()<deadline) vTaskDelay(pdMS_TO_TICKS(10));
                okay=requested && host_committed.load();portENTER_CRITICAL(&commit_lock);commit_nonce.fill(0);portEXIT_CRITICAL(&commit_lock);
            }
            session.pending=false;psa_hash_abort(&session.hash);
            const bool replied=channel.response(okay ? 200 : 422,"",true);
            record("{\"event\":\"transfer_complete\",\"transfer_id\":\"%s\",\"host_committed\":%s,\"response_written\":%s}\n",session.manifest.transfer_id.data(),okay ? "true" : "false",replied ? "true" : "false");
            return;
        } else {channel.response(404,"",true);return;}
    }
}
void server(void*) {
    mbedtls_x509_crt cert;mbedtls_pk_context key;mbedtls_ssl_config config;
    mbedtls_x509_crt_init(&cert);mbedtls_pk_init(&key);mbedtls_ssl_config_init(&config);
    int fd=-1;int error=0;
    std::uint8_t *body=nullptr,*compressed=nullptr,*expanded=nullptr;
    Session* session=nullptr;
    auto run=[&]() -> int {
        if(psa_crypto_init()!=PSA_SUCCESS) return -1;
        int rc=mbedtls_x509_crt_parse(&cert,reinterpret_cast<const unsigned char*>(identity_assets::certificate),sizeof(identity_assets::certificate));if(rc) return rc;
        rc=mbedtls_pk_parse_key(&key,reinterpret_cast<const unsigned char*>(identity_assets::private_key),sizeof(identity_assets::private_key),nullptr,0);if(rc) return rc;
        rc=mbedtls_ssl_config_defaults(&config,MBEDTLS_SSL_IS_SERVER,MBEDTLS_SSL_TRANSPORT_STREAM,MBEDTLS_SSL_PRESET_DEFAULT);if(rc) return rc;
        mbedtls_ssl_conf_authmode(&config,MBEDTLS_SSL_VERIFY_NONE);mbedtls_ssl_conf_min_tls_version(&config,MBEDTLS_SSL_VERSION_TLS1_2);mbedtls_ssl_conf_max_tls_version(&config,MBEDTLS_SSL_VERSION_TLS1_2);
        rc=mbedtls_ssl_conf_own_cert(&config,&cert,&key);if(rc) return rc;
        body=static_cast<std::uint8_t*>(heap_caps_malloc(131072,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));
        compressed=static_cast<std::uint8_t*>(heap_caps_malloc(263168,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));
        expanded=static_cast<std::uint8_t*>(heap_caps_malloc(262144,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));
        session=new(std::nothrow) Session;
        if(!body || !compressed || !expanded || !session) return -ENOMEM;
        fd=socket(AF_INET6,SOCK_STREAM,0);if(fd<0) return -errno;
        sockaddr_in6 address{};address.sin6_family=AF_INET6;address.sin6_port=htons(8770);address.sin6_scope_id=ipv6_link_index();
        const auto local=awdl::link_local(identity);std::memcpy(&address.sin6_addr,local.data(),16);
        if(bind(fd,reinterpret_cast<sockaddr*>(&address),sizeof(address)) || listen(fd,2)) return -errno;
        listening=true;event("native_receiver_ready");
        for(;;) {
            sockaddr_in6 peer{};socklen_t length=sizeof(peer);int connection=accept(fd,reinterpret_cast<sockaddr*>(&peer),&length);if(connection<0) {vTaskDelay(pdMS_TO_TICKS(20));continue;}
            const auto permitted=awdl::link_local(allowed);
            if(std::memcmp(&peer.sin6_addr,permitted.data(),16)) {close(connection);event("receiver_peer_rejected");continue;}
            fcntl(connection,F_SETFL,O_NONBLOCK);mbedtls_ssl_context tls;mbedtls_ssl_init(&tls);
            int result=mbedtls_ssl_setup(&tls,&config);mbedtls_ssl_set_bio(&tls,&connection,send_tls,recv_tls,nullptr);
            const auto deadline=esp_timer_get_time()+30'000'000;
            while(!result) {const int handshake=mbedtls_ssl_handshake(&tls);if(!handshake) break;if(!again(handshake) || esp_timer_get_time()>deadline) {result=handshake;break;}vTaskDelay(pdMS_TO_TICKS(2));}
            if(!result) {event("native_tls_ready");serve_client(tls,*session,body,compressed,expanded);}else event("native_tls_failed",result);
            mbedtls_ssl_close_notify(&tls);mbedtls_ssl_free(&tls);close(connection);
        }
    };
    error=run();listening=false;event("native_receiver_failed",error);
    if(fd>=0) close(fd);
    free(body);free(compressed);free(expanded);delete session;
    mbedtls_ssl_config_free(&config);mbedtls_pk_free(&key);mbedtls_x509_crt_free(&cert);vTaskDelete(nullptr);
}
void mdns(void*) {
    const int fd=socket(AF_INET6,SOCK_DGRAM,0);if(fd<0) {event("mdns_failed",errno);vTaskDelete(nullptr);return;}
    const int yes=1,hops=255,index=int(ipv6_link_index());setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&yes,sizeof(yes));
    setsockopt(fd,IPPROTO_IPV6,IPV6_MULTICAST_IF,&index,sizeof(index));setsockopt(fd,IPPROTO_IPV6,IPV6_MULTICAST_HOPS,&hops,sizeof(hops));setsockopt(fd,IPPROTO_IP,IP_TTL,&hops,sizeof(hops));
    sockaddr_in6 bind_address{};bind_address.sin6_family=AF_INET6;bind_address.sin6_port=htons(5353);bind_address.sin6_scope_id=unsigned(index);
    ipv6_mreq group{};inet6_aton("ff02::fb",&group.ipv6mr_multiaddr);group.ipv6mr_interface=unsigned(index);
    if(bind(fd,reinterpret_cast<sockaddr*>(&bind_address),sizeof(bind_address)) || setsockopt(fd,IPPROTO_IPV6,IPV6_JOIN_GROUP,&group,sizeof(group))) {event("mdns_failed",errno);close(fd);vTaskDelete(nullptr);return;}
    sockaddr_in6 multicast=bind_address;multicast.sin6_addr=group.ipv6mr_multiaddr;
    fcntl(fd,F_SETFL,O_NONBLOCK);native::MdnsPacket packet{};std::array<std::uint8_t,1280> query{};std::int64_t next=0;
    for(;;) {
        if(!listening) {vTaskDelay(pdMS_TO_TICKS(100));continue;}
        sockaddr_in6 peer{};socklen_t length=sizeof(peer);const int count=int(recvfrom(fd,query.data(),query.size(),0,reinterpret_cast<sockaddr*>(&peer),&length));
        if(count>0 && native::mdns_question({query.data(),std::size_t(count)},identity)) {
            native::mdns_announcement(identity,8770,std::uint16_t(unsigned(query[0])<<8|query[1]),packet);
            sendto(fd,packet.bytes.data(),packet.size,0,reinterpret_cast<sockaddr*>(&peer),sizeof(peer));event("mdns_query_answered");
        }
        if(esp_timer_get_time()>=next) {next=esp_timer_get_time()+5'000'000;native::mdns_announcement(identity,8770,0,packet);sendto(fd,packet.bytes.data(),packet.size,0,reinterpret_cast<sockaddr*>(&multicast),sizeof(multicast));}
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
}
esp_err_t native_receiver_begin(const awdl::Mac& own,const awdl::Mac& allowed_peer) {
    identity=own;allowed=allowed_peer;
    if(xTaskCreatePinnedToCore(commands,"serial_commit",4096,nullptr,1,nullptr,1)!=pdPASS ||
       xTaskCreatePinnedToCore(server,"airdrop_receive",32768,nullptr,1,nullptr,1)!=pdPASS ||
       xTaskCreatePinnedToCore(mdns,"airdrop_mdns",6144,nullptr,1,nullptr,1)!=pdPASS) return ESP_ERR_NO_MEM;
    return ESP_OK;
}
