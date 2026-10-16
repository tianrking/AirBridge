// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "native_sender.hpp"

#include <fcntl.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <new>

#include "discover.hpp"
#include "ble_presence.hpp"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "identity_credentials.hpp"
#include "ipv6_link.hpp"
#include "lwip/sockets.h"
#include "mbedtls/base64.h"
#include "mbedtls/pk.h"
#include "mbedtls/ssl.h"
#include "mbedtls/x509_crt.h"
#include "native_service.hpp"
#include "psa/crypto.h"
#include "serial_channel.hpp"
#include "serial_protocol.hpp"
using namespace airbridge;
namespace {
constexpr std::size_t maximum_file = 1024 * 1024, maximum_metadata = 131072;
awdl::Mac identity{}, permitted_peer{};
struct ObservedPeer { awdl::Mac mac{}; std::uint16_t port{}; std::uint64_t received{}; };
std::array<ObservedPeer, 12> observed{};
awdl::Mac preferred_peer{};
portMUX_TYPE peer_lock = portMUX_INITIALIZER_UNLOCKED;
std::atomic<bool> busy{}, cancelled{};
serial::ReplayGuard replay;
std::array<char, 17> session{};
std::array<char, 512> last_reply{};
struct Upload {
    std::uint8_t *file{}, *metadata{};
    std::size_t size{}, metadata_size{}, written{}, metadata_written{};
    std::array<std::uint8_t, 32> expected_hash{};
    std::array<char, 65> digest{};
    native::AskManifest manifest{};
    std::uint16_t port{};
    awdl::Mac peer{};
    bool resolve_only{};
} upload;
bool eligible_peer(const awdl::Mac& peer, std::uint16_t port) {
    if (peer == permitted_peer) return true;
    bool found = false;
    const auto now = std::uint64_t(esp_timer_get_time());
    portENTER_CRITICAL(&peer_lock);
    for (const auto& item : observed)
        if (item.mac == peer && item.port == port && now >= item.received && now - item.received < 10'000'000)
            found = true;
    portEXIT_CRITICAL(&peer_lock);
    return found;
}
void clear_upload() {
    free(upload.file);
    free(upload.metadata);
    upload = Upload{};
}
bool record(const char* format, ...) {
    std::array<char, 1024> line{};
    va_list args;
    va_start(args, format);
    const auto size = std::vsnprintf(line.data(), line.size(), format, args);
    va_end(args);
    return size > 0 && std::size_t(size) < line.size() &&
           serial_record(line.data(), std::size_t(size));
}
void stage(const char* name, unsigned status = 0) {
    record("{\"event\":\"%s\",\"stage\":\"%s\",\"http_status\":%u}\n",
           upload.resolve_only ? "resolve_stage" : "outgoing_stage", name, status);
}
bool retry(int result) {
    return result == MBEDTLS_ERR_SSL_WANT_READ || result == MBEDTLS_ERR_SSL_WANT_WRITE;
}
int send_bytes(void* context, const unsigned char* data, std::size_t size) {
    const auto result = int(send(*static_cast<int*>(context), data, size, 0));
    return result >= 0                               ? result
           : errno == EAGAIN || errno == EWOULDBLOCK ? MBEDTLS_ERR_SSL_WANT_WRITE
                                                     : MBEDTLS_ERR_SSL_INTERNAL_ERROR;
}
int receive_bytes(void* context, unsigned char* data, std::size_t size) {
    const auto result = int(recv(*static_cast<int*>(context), data, size, 0));
    return result >= 0                               ? result
           : errno == EAGAIN || errno == EWOULDBLOCK ? MBEDTLS_ERR_SSL_WANT_READ
                                                     : MBEDTLS_ERR_SSL_INTERNAL_ERROR;
}
struct Client {
    mbedtls_ssl_context tls;
    mbedtls_ssl_config config;
    mbedtls_x509_crt certificate;
    mbedtls_pk_context key;
    std::array<std::uint8_t, 24576> wire{};
    int fd{-1};
    unsigned http_status{};
    Client() {
        mbedtls_ssl_init(&tls);
        mbedtls_ssl_config_init(&config);
        mbedtls_x509_crt_init(&certificate);
        mbedtls_pk_init(&key);
    }
    ~Client() {
        disconnect();
        mbedtls_ssl_free(&tls);
        mbedtls_ssl_config_free(&config);
        mbedtls_x509_crt_free(&certificate);
        mbedtls_pk_free(&key);
    }
    void disconnect() {
        if (fd >= 0) {
            mbedtls_ssl_close_notify(&tls);
            close(fd);
            fd = -1;
        }
    }
    int initialize() {
        stage("crypto_initialize");
        if (psa_crypto_init() != PSA_SUCCESS)
            return -EIO;
        stage("tls_certificate");
        int rc = mbedtls_x509_crt_parse(
            &certificate, reinterpret_cast<const unsigned char*>(identity_assets::certificate),
            sizeof(identity_assets::certificate));
        if (rc)
            return rc;
        stage("tls_private_key");
        rc = mbedtls_pk_parse_key(
            &key, reinterpret_cast<const unsigned char*>(identity_assets::private_key),
            sizeof(identity_assets::private_key), nullptr, 0);
        if (rc)
            return rc;
        stage("tls_configuration");
        rc = mbedtls_ssl_config_defaults(&config, MBEDTLS_SSL_IS_CLIENT,
                                         MBEDTLS_SSL_TRANSPORT_STREAM, MBEDTLS_SSL_PRESET_DEFAULT);
        if (rc)
            return rc;
        mbedtls_ssl_conf_authmode(&config, MBEDTLS_SSL_VERIFY_NONE);
        mbedtls_ssl_conf_min_tls_version(&config, MBEDTLS_SSL_VERSION_TLS1_2);
        mbedtls_ssl_conf_max_tls_version(&config, MBEDTLS_SSL_VERSION_TLS1_2);
        rc = mbedtls_ssl_conf_own_cert(&config, &certificate, &key);
        if (rc)
            return rc;
        stage("tls_allocate");
        return mbedtls_ssl_setup(&tls, &config);
    }
    int connect_peer() {
        disconnect();
        int rc = mbedtls_ssl_session_reset(&tls);
        if (rc)
            return rc;
        fd = socket(AF_INET6, SOCK_STREAM, 0);
        if (fd < 0)
            return -errno;
        if (fcntl(fd, F_SETFL, O_NONBLOCK) < 0)
            return -errno;
        sockaddr_in6 address{};
        address.sin6_family = AF_INET6;
        address.sin6_port = htons(upload.port);
        address.sin6_scope_id = ipv6_link_index();
        const auto ip = awdl::link_local(upload.peer);
        std::memcpy(&address.sin6_addr, ip.data(), ip.size());
        rc = connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address));
        if (rc < 0) {
            if (errno != EINPROGRESS && errno != EWOULDBLOCK)
                return -errno;
            const auto deadline = esp_timer_get_time() + 10'000'000;
            for (;;) {
                if (cancelled)
                    return -ECANCELED;
                fd_set writes;
                FD_ZERO(&writes);
                FD_SET(fd, &writes);
                timeval wait{0, 250000};
                rc = select(fd + 1, nullptr, &writes, nullptr, &wait);
                if (rc < 0)
                    return -errno;
                if (rc > 0)
                    break;
                if (esp_timer_get_time() >= deadline)
                    return -ETIMEDOUT;
            }
            int error = 0;
            socklen_t size = sizeof(error);
            if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) < 0)
                return -errno;
            if (error)
                return -error;
        }
        stage("tls_handshake");
        mbedtls_ssl_set_bio(&tls, &fd, send_bytes, receive_bytes, nullptr);
        const auto deadline = esp_timer_get_time() + 30'000'000;
        for (;;) {
            if (cancelled)
                return -ECANCELED;
            rc = mbedtls_ssl_handshake(&tls);
            if (!rc)
                return 0;
            if (!retry(rc))
                return rc;
            if (esp_timer_get_time() >= deadline)
                return -ETIMEDOUT;
            vTaskDelay(pdMS_TO_TICKS(2));
        }
    }
    int write(awdl::Bytes bytes) {
        std::size_t sent = 0;
        auto deadline = esp_timer_get_time() + 30'000'000;
        while (sent < bytes.size) {
            if (cancelled)
                return -ECANCELED;
            const auto rc = mbedtls_ssl_write(&tls, bytes.data + sent,
                                              std::min(std::size_t{16384}, bytes.size - sent));
            if (rc > 0) {
                sent += std::size_t(rc);
                deadline = esp_timer_get_time() + 30'000'000;
            } else if (!retry(rc))
                return rc ? rc : -EPIPE;
            if (esp_timer_get_time() > deadline)
                return -ETIMEDOUT;
            vTaskDelay(pdMS_TO_TICKS(1));
        }
        return 0;
    }
    int request(const char* path, const char* type, std::size_t length, bool close,
                const char* extra = "") {
        std::array<char, 768> header{};
        const int count = std::snprintf(
            header.data(), header.size(),
            "POST %s HTTP/1.1\r\nHost: airbridge.local\r\nUser-Agent: AirDrop/1.0\r\nContent-Type: "
            "%s\r\nContent-Length: %u\r\nConnection: %s\r\n%s\r\n",
            path, type, unsigned(length), close ? "close" : "keep-alive", extra);
        return count > 0 && std::size_t(count) < header.size()
                   ? write(
                         {reinterpret_cast<const std::uint8_t*>(header.data()), std::size_t(count)})
                   : -EINVAL;
    }
    int response(discovery::HttpResponse& output, unsigned seconds = 30) {
        std::size_t used = 0;
        const auto deadline = esp_timer_get_time() + std::int64_t(seconds) * 1'000'000;
        while (used < wire.size()) {
            if (cancelled)
                return -ECANCELED;
            const int rc = mbedtls_ssl_read(&tls, wire.data() + used, wire.size() - used);
            bool eof = false;
            if (rc > 0)
                used += std::size_t(rc);
            else if (!rc || rc == MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY ||
                     rc == MBEDTLS_ERR_SSL_CONN_EOF)
                eof = true;
            else if (!retry(rc))
                return rc;
            const auto parsed = discovery::parse_http_response(wire.data(), used, output, eof);
            if (parsed == awdl::Error::none) {
                http_status = output.status;
                return output.status == 200 ? 0 : -EPROTO;
            }
            if (parsed != awdl::Error::truncated)
                return -EBADMSG;
            if (eof)
                return -EPIPE;
            if (esp_timer_get_time() >= deadline)
                return -ETIMEDOUT;
            vTaskDelay(pdMS_TO_TICKS(2));
        }
        return -EOVERFLOW;
    }
};
void send_worker(void*) {
    const auto start = esp_timer_get_time();
    record("{\"event\":\"outgoing_memory\",\"internal_free\":%u,\"internal_largest\":%u,"
           "\"psram_free\":%u}\n", unsigned(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)),
           unsigned(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)),
           unsigned(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)));
    int result = -ENOMEM;
    unsigned status = 0;
    auto* client_memory = heap_caps_malloc(sizeof(Client), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    auto* client = client_memory ? new (client_memory) Client : nullptr;
    std::uint8_t* archive = nullptr;
    auto perform = [&]() -> int {
        if (!client)
            return -ENOMEM;
        int rc = client->initialize();
        if (rc)
            return rc;
        stage("discover_connect");
        rc = client->connect_peer();
        // Keep a live native listener and admitted neighbor undisturbed. Only
        // retry the read-only discovery connection; Ask/Upload are never replayed.
        for (unsigned attempt = 0; rc && attempt < 2 && !cancelled; ++attempt) {
            if (rc != -ETIMEDOUT && rc != -ECONNREFUSED && rc != -ECONNRESET && rc != -EHOSTUNREACH)
                break;
            stage("wake_peer");
            const auto wake = ble_presence_refresh();
            if (wake) return wake;
            vTaskDelay(pdMS_TO_TICKS(750));
            stage("discover_connect");
            rc = client->connect_peer();
        }
        if (rc)
            return rc;
        const auto request = discovery::discover_request(111611);
        if ((rc = client->request("/Discover", "application/octet-stream", request.size(), true)) ||
            (rc = client->write({request.data(), request.size()})))
            return rc;
        discovery::HttpResponse response{};
        rc = client->response(response);
        if (rc)
            return rc;
        discovery::Identity peer{};
        if (discovery::parse_identity_plist(response.body, peer) != awdl::Error::none)
            return -EBADMSG;
        if (peer.has_airdropable && !peer.airdropable)
            return -EACCES;
        std::array<unsigned char, 344> encoded{};
        std::size_t encoded_size = 0;
        if (mbedtls_base64_encode(encoded.data(), encoded.size(), &encoded_size,
                                  reinterpret_cast<const unsigned char*>(peer.name.data()),
                                  std::strlen(peer.name.data())))
            return -EINVAL;
        if (upload.resolve_only) {
            const auto& p = upload.peer;
            record("{\"event\":\"peer_resolved\",\"mac\":\"%02x:%02x:%02x:%02x:%02x:%02x\","
                   "\"name_b64\":\"%s\",\"name_source\":\"airdrop_discover\"}\n",
                   p[0],p[1],p[2],p[3],p[4],p[5],encoded.data());
            return 0;
        }
        record("{\"event\":\"outgoing_peer\",\"name_b64\":\"%s\"}\n", encoded.data());
        // Apple's Discover handler is disposable. Ask and Upload use a fresh connection.
        stage("ask_connect");
        rc = client->connect_peer();
        if (rc)
            return rc;
        if ((rc = client->request("/Ask", "application/octet-stream", upload.metadata_size,
                                  false)) ||
            (rc = client->write({upload.metadata, upload.metadata_size})))
            return rc;
        stage("awaiting_acceptance");
        rc = client->response(response, 180);
        if (rc)
            return rc;
        stage("accepted", response.status);
        archive = static_cast<std::uint8_t*>(
            heap_caps_malloc(upload.size + 512, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        if (!archive)
            return -ENOMEM;
        struct Buffer {
            std::uint8_t* bytes;
            std::size_t size{}, capacity;
        } buffer{archive, 0, upload.size + 512};
        const auto append = [](void* context, awdl::Bytes bytes) {
            auto& out = *static_cast<Buffer*>(context);
            if (bytes.size > out.capacity - out.size)
                return false;
            std::memcpy(out.bytes + out.size, bytes.data, bytes.size);
            out.size += bytes.size;
            return true;
        };
        if (transfer::write_cpio_header(upload.manifest.files[0].name.data(),
                                        std::uint32_t(upload.size), append,
                                        &buffer) != awdl::Error::none ||
            !append(&buffer, {upload.file, upload.size}) ||
            transfer::write_cpio_trailer(append, &buffer) != awdl::Error::none)
            return -EBADMSG;
        std::array<char, 192> extra{};
        const int extra_size =
            std::snprintf(extra.data(), extra.size(), "TransferID: %s\r\nTotalBytes: %u\r\n",
                          upload.manifest.transfer_id.data(), unsigned(upload.size));
        if (extra_size <= 0 || std::size_t(extra_size) >= extra.size())
            return -EINVAL;
        const auto length = buffer.size + 4 * ((buffer.size + 65535) / 65536);
        if ((rc = client->request("/Upload", "application/x-dvzip", length, true, extra.data())))
            return rc;
        stage("uploading");
        struct Output {
            Client* client;
            std::size_t sent{}, total;
            int error{};
        } output{client, 0, length, 0};
        const auto emit = [](void* context, awdl::Bytes bytes) {
            auto& out = *static_cast<Output*>(context);
            out.error = out.client->write(bytes);
            if (out.error)
                return false;
            out.sent += bytes.size;
            record("{\"event\":\"outgoing_progress\",\"wire_bytes\":%u,\"wire_total\":%u}\n",
                   unsigned(out.sent), unsigned(out.total));
            return true;
        };
        if (transfer::write_dvzip_stored({archive, buffer.size}, emit, &output) !=
            awdl::Error::none)
            return output.error ? output.error : -EIO;
        rc = client->response(response, 120);
        status = response.status;
        return rc;
    };
    result = perform();
    if (client && !status)
        status = client->http_status;
    if (upload.resolve_only) {
        const auto& p = upload.peer;
        record("{\"event\":\"resolution_complete\",\"mac\":\"%02x:%02x:%02x:%02x:%02x:%02x\","
               "\"error\":%d,\"http_status\":%u}\n",p[0],p[1],p[2],p[3],p[4],p[5],result,status);
    } else record(
        "{\"event\":\"outgoing_complete\",\"success\":%s,\"error\":%d,\"http_status\":%u,"
        "\"transfer_id\":\"%s\",\"bytes\":%u,\"sha256\":\"%s\",\"elapsed_ms\":%llu}\n",
        result == 0 ? "true" : "false", result, status, upload.manifest.transfer_id.data(),
        unsigned(upload.size), upload.digest.data(),
        static_cast<unsigned long long>((esp_timer_get_time() - start) / 1000));
    free(archive);
    if (client)
        client->~Client();
    free(client_memory);
    clear_upload();
    busy = false;
    vTaskDelete(nullptr);
}
bool hexadecimal(const char* value, std::size_t size, std::uint8_t* result = nullptr) {
    if (std::strlen(value) != size)
        return false;
    for (std::size_t at = 0; at < size; at++) {
        const auto c = value[at];
        const int digit = c >= '0' && c <= '9'   ? c - '0'
                          : c >= 'a' && c <= 'f' ? c - 'a' + 10
                          : c >= 'A' && c <= 'F' ? c - 'A' + 10
                                                 : -1;
        if (digit < 0)
            return false;
        if (result) {
            if (!(at & 1))
                result[at / 2] = std::uint8_t(digit << 4);
            else
                result[at / 2] |= std::uint8_t(digit);
        }
    }
    return true;
}
void reply(const serial::Command& command, bool okay, const char* reason, std::size_t offset = 0,
           bool remember = true) {
    std::array<char, 512> line{};
    const int count =
        std::snprintf(line.data(), line.size(),
                      "{\"event\":\"command_reply\",\"sequence\":%lu,\"ok\":%s,\"reason\":\"%s\","
                      "\"offset\":%u,\"protocol\":2,\"max_file\":%u,\"chunk_bytes\":112,\"radio_"
                      "mac\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"resolve\":true,"
                      "\"paired_peer\":\"%02x:%02x:%02x:%02x:%02x:%02x\"}\n",
                      static_cast<unsigned long>(command.sequence), okay ? "true" : "false", reason,
                      unsigned(offset), unsigned(maximum_file), identity[0], identity[1],
                      identity[2], identity[3], identity[4], identity[5],permitted_peer[0],permitted_peer[1],
                      permitted_peer[2],permitted_peer[3],permitted_peer[4],permitted_peer[5]);
    if (count > 0 && std::size_t(count) < line.size()) {
        if (remember) {
            replay.remember(command);
            last_reply = line;
        }
        serial_record(line.data(), std::size_t(count));
    }
}
}  // namespace
void native_sender_begin(const awdl::Mac& own, const awdl::Mac& permitted) {
    identity = own;
    permitted_peer = permitted;
    preferred_peer = permitted;
}
void native_sender_observe(const awdl::Announcement& peer, std::uint64_t received_us) {
    if (!peer.service.airdrop || !peer.service.port || (peer.source[0] & 1) || peer.source == identity) return;
    portENTER_CRITICAL(&peer_lock);
    auto* selected = &observed[0];
    for (auto& item : observed) {
        if (item.mac == peer.source) { selected = &item; break; }
        if (item.received < selected->received) selected = &item;
    }
    *selected = {peer.source, peer.service.port, received_us};
    portEXIT_CRITICAL(&peer_lock);
}
bool native_sender_sync_peer(awdl::Mac& peer) {
    portENTER_CRITICAL(&peer_lock); peer = preferred_peer; portEXIT_CRITICAL(&peer_lock);
    return peer != awdl::Mac{};
}
bool native_sender_command(awdl::Bytes line) {
    if (line.size < 4 || std::memcmp(line.data, "AB2 ", 4))
        return false;
    serial::Command command{};
    if (serial::parse_command(line, command) != awdl::Error::none) {
        record("{\"event\":\"command_invalid\",\"reason\":\"framing_or_crc\"}\n");
        return true;
    }
    std::array<char, 17> token{};
    char extra = 0;
    if (std::sscanf(command.body.data(), "HELLO %16s %c", token.data(), &extra) == 1 &&
        !std::strncmp(command.body.data(), "HELLO ", 6)) {
        if (!hexadecimal(token.data(), 16)) {
            reply(command, false, "invalid_session", 0, false);
            return true;
        }
        if (busy) {
            reply(command, false, "busy", 0, false);
            return true;
        }
        if (token != session) {
            clear_upload();
            session = token;
            replay.reset();
        }
        reply(command, true, "hello", upload.written, false);
        return true;
    }
    const auto* body = command.body.data();
    if (!session[0] || std::strlen(body) < 18 || std::memcmp(body, session.data(), 16) ||
        body[16] != ' ') {
        reply(command, false, "session_mismatch", 0, false);
        return true;
    }
    body += 17;
    const auto check = replay.check(command);
    if (check == serial::Replay::repeat) {
        serial_record(last_reply.data(), std::strlen(last_reply.data()));
        return true;
    }
    if (check != serial::Replay::fresh) {
        reply(command, false, "stale_or_conflicting_sequence", 0, false);
        return true;
    }
    if (!std::strcmp(body, "CANCEL")) {
        if (busy)
            cancelled = true;
        else
            clear_upload();
        reply(command, true, "cancelled");
        return true;
    }
    if (!std::strcmp(body, "STATUS")) {
        reply(command, true,
              busy          ? "sending"
              : upload.file ? "staging"
                            : "idle",
              busy ? 0 : upload.written);
        return true;
    }
    if (busy) {
        reply(command, false, "busy");
        return true;
    }
    if (!std::strncmp(body, "RESOLVE ", 8)) {
        unsigned octets[6]{}, port = 0;
        char extra = 0;
        if (std::sscanf(body + 8, "%2x:%2x:%2x:%2x:%2x:%2x %u %c", &octets[0], &octets[1],
                        &octets[2], &octets[3], &octets[4], &octets[5], &port, &extra) != 7 || !port || port > 65535) {
            reply(command, false, "invalid_recipient"); return true;
        }
        awdl::Mac requested{}; for (unsigned i=0;i<6;i++) requested[i]=std::uint8_t(octets[i]);
        if (!eligible_peer(requested,std::uint16_t(port))) {reply(command,false,"recipient_not_advertised");return true;}
        clear_upload(); upload.peer=requested;upload.port=std::uint16_t(port);upload.resolve_only=true;
        portENTER_CRITICAL(&peer_lock);preferred_peer=requested;portEXIT_CRITICAL(&peer_lock);
        cancelled=false;busy=true;
        if (xTaskCreatePinnedToCore(send_worker,"airdrop_resolve",16384,nullptr,1,nullptr,1)!=pdPASS) {
            busy=false;clear_upload();reply(command,false,"out_of_memory");return true;
        }
        reply(command,true,"resolving");return true;
    }
    if (!std::strncmp(body, "BEGIN ", 6)) {
        unsigned long size = 0, metadata = 0, port = 0;
        std::array<char, 65> digest{};
        std::array<char, 18> peer{};
        const int count = std::sscanf(body + 6, "%lu %lu %64s %17s %lu %c", &size, &metadata,
                                      digest.data(), peer.data(), &port, &extra);
        unsigned octets[6]{};
        char trailing = 0;
        awdl::Mac requested{};
        const int fields =
            std::sscanf(peer.data(), "%2x:%2x:%2x:%2x:%2x:%2x%c", &octets[0], &octets[1],
                        &octets[2], &octets[3], &octets[4], &octets[5], &trailing);
        for (unsigned i = 0; i < 6; i++)
            requested[i] = std::uint8_t(octets[i]);
        std::array<std::uint8_t, 32> hash{};
        if (count != 5 || size > maximum_file || metadata < 40 || metadata > maximum_metadata ||
            !port || port > 65535 || fields != 6 || !eligible_peer(requested,std::uint16_t(port)) ||
            !hexadecimal(digest.data(), 64, hash.data())) {
            reply(command, false, "invalid_begin");
            return true;
        }
        clear_upload();
        upload.file = static_cast<std::uint8_t*>(heap_caps_malloc(
            std::max(std::size_t{1}, std::size_t(size)), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        upload.metadata = static_cast<std::uint8_t*>(
            heap_caps_malloc(metadata, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        if (!upload.file || !upload.metadata) {
            clear_upload();
            reply(command, false, "out_of_memory");
            return true;
        }
        upload.size = size;
        upload.metadata_size = metadata;
        upload.expected_hash = hash;
        upload.port = std::uint16_t(port);
        upload.peer = requested;
        portENTER_CRITICAL(&peer_lock);preferred_peer=requested;portEXIT_CRITICAL(&peer_lock);
        constexpr char digits[] = "0123456789abcdef";
        for (unsigned i = 0; i < 32; i++) {
            upload.digest[i * 2] = digits[hash[i] >> 4];
            upload.digest[i * 2 + 1] = digits[hash[i] & 15];
        }
        reply(command, true, "ready");
        return true;
    }
    const bool metadata = !std::strncmp(body, "META ", 5), data = !std::strncmp(body, "DATA ", 5);
    if (metadata || data) {
        unsigned long offset = 0;
        std::array<char, 153> encoded{};
        std::array<unsigned char, 112> decoded{};
        std::size_t size = 0;
        const int count = std::sscanf(body + 5, "%lu %152s %c", &offset, encoded.data(), &extra);
        if (!upload.file || count != 2 ||
            mbedtls_base64_decode(decoded.data(), decoded.size(), &size,
                                  reinterpret_cast<const unsigned char*>(encoded.data()),
                                  std::strlen(encoded.data())) ||
            !size) {
            reply(command, false, "invalid_chunk");
            return true;
        }
        auto& written = metadata ? upload.metadata_written : upload.written;
        const auto total = metadata ? upload.metadata_size : upload.size;
        if (offset != written || size > total - written) {
            reply(command, false, "offset_or_length");
            return true;
        }
        std::memcpy((metadata ? upload.metadata : upload.file) + written, decoded.data(), size);
        written += size;
        reply(command, true, "chunk", written);
        return true;
    }
    if (!std::strcmp(body, "SEND")) {
        if (!upload.file || upload.written != upload.size ||
            upload.metadata_written != upload.metadata_size) {
            reply(command, false, "incomplete_upload");
            return true;
        }
        std::array<std::uint8_t, 32> hash{};
        std::size_t size = 0;
        if (psa_crypto_init() != PSA_SUCCESS ||
            psa_hash_compute(PSA_ALG_SHA_256, upload.file, upload.size, hash.data(), hash.size(),
                             &size) != PSA_SUCCESS ||
            size != 32 || hash != upload.expected_hash) {
            clear_upload();
            reply(command, false, "sha256_mismatch");
            return true;
        }
        if (native::parse_ask({upload.metadata, upload.metadata_size}, upload.manifest) !=
                awdl::Error::none ||
            upload.manifest.count != 1 || upload.manifest.total != upload.size) {
            clear_upload();
            reply(command, false, "manifest_mismatch");
            return true;
        }
        cancelled = false;
        busy = true;
        if (xTaskCreatePinnedToCore(send_worker, "airdrop_send", 16384, nullptr, 1, nullptr, 1) !=
            pdPASS) {
            busy = false;
            reply(command, false, "out_of_memory");
            return true;
        }
        reply(command, true, "sending");
        return true;
    }
    reply(command, false, "unknown_command");
    return true;
}
