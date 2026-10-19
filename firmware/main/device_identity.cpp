#include "device_identity.hpp"
#include <array>
#include <cstdint>
#include <cstring>
#include "esp_random.h"
#include "nvs.h"
#include "psa/crypto.h"

namespace {
struct Identity {
    std::uint32_t version{};
    std::array<std::uint8_t, 32> key{};
    std::array<char, 1536> certificate{};
};
Identity identity;
psa_key_id_t key_id{};
bool ready{};
psa_key_attributes_t attributes() {
    psa_key_attributes_t a = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_type(&a, PSA_KEY_TYPE_ECC_KEY_PAIR(PSA_ECC_FAMILY_SECP_R1));
    psa_set_key_bits(&a, 256);
    psa_set_key_algorithm(&a, PSA_ALG_ECDSA(PSA_ALG_SHA_256));
    psa_set_key_usage_flags(&a, PSA_KEY_USAGE_SIGN_HASH | PSA_KEY_USAGE_VERIFY_HASH | PSA_KEY_USAGE_EXPORT);
    return a;
}
}
int device_identity_load(mbedtls_x509_crt& certificate, mbedtls_pk_context& key) {
    if (!ready) return -1;
    int rc = mbedtls_x509_crt_parse(&certificate,
        reinterpret_cast<const unsigned char*>(identity.certificate.data()),
        std::strlen(identity.certificate.data()) + 1);
    if (!rc) rc = mbedtls_pk_wrap_psa(&key, key_id);
    if (!rc) rc = mbedtls_pk_check_pair(&certificate.pk, &key);
    return rc;
}
esp_err_t device_identity_begin() {
    if (ready) return ESP_OK;
    if (psa_crypto_init() != PSA_SUCCESS) return ESP_FAIL;
    nvs_handle_t storage{};
    esp_err_t rc = nvs_open("airbridge", NVS_READWRITE, &storage);
    if (rc != ESP_OK) return rc;
    auto a = attributes();
    auto run = [&]() -> esp_err_t {
        std::size_t size = sizeof(identity);
        const auto loaded = nvs_get_blob(storage, "tls_identity", &identity, &size);
        if (loaded == ESP_OK) {
            if (size != sizeof(identity) || identity.version != 1 ||
                !std::memchr(identity.certificate.data(), 0, identity.certificate.size())) return ESP_ERR_INVALID_STATE;
            if (psa_import_key(&a, identity.key.data(), identity.key.size(), &key_id) != PSA_SUCCESS) return ESP_FAIL;
        } else if (loaded == ESP_ERR_NVS_NOT_FOUND) {
            identity = {};
            identity.version = 1;
            if (psa_generate_key(&a, &key_id) != PSA_SUCCESS) return ESP_FAIL;
            if (psa_export_key(key_id, identity.key.data(), identity.key.size(), &size) != PSA_SUCCESS || size != identity.key.size()) return ESP_FAIL;
            mbedtls_pk_context signer;
            mbedtls_x509write_cert writer;
            mbedtls_pk_init(&signer);
            mbedtls_x509write_crt_init(&writer);
            int error = mbedtls_pk_wrap_psa(&signer, key_id);
            mbedtls_x509write_crt_set_version(&writer, MBEDTLS_X509_CRT_VERSION_3);
            mbedtls_x509write_crt_set_md_alg(&writer, MBEDTLS_MD_SHA256);
            mbedtls_x509write_crt_set_subject_key(&writer, &signer);
            mbedtls_x509write_crt_set_issuer_key(&writer, &signer);
            std::array<unsigned char, 16> serial{};
            esp_fill_random(serial.data(), serial.size()); serial[0] = (serial[0] & 0x7f) | 1;
            if (!error) error = mbedtls_x509write_crt_set_serial_raw(&writer, serial.data(), serial.size());
            if (!error) error = mbedtls_x509write_crt_set_subject_name(&writer, "CN=AirBridge PC");
            if (!error) error = mbedtls_x509write_crt_set_issuer_name(&writer, "CN=AirBridge PC");
            if (!error) error = mbedtls_x509write_crt_set_validity(&writer, "20200101000000", "20400101000000");
            if (!error) error = mbedtls_x509write_crt_set_basic_constraints(&writer, 0, -1);
            if (!error) error = mbedtls_x509write_crt_set_key_usage(&writer, MBEDTLS_X509_KU_DIGITAL_SIGNATURE);
            if (!error) error = mbedtls_x509write_crt_pem(&writer,
                reinterpret_cast<unsigned char*>(identity.certificate.data()), identity.certificate.size());
            mbedtls_x509write_crt_free(&writer); mbedtls_pk_free(&signer);
            if (error) return ESP_FAIL;
            rc = nvs_set_blob(storage, "tls_identity", &identity, sizeof(identity));
            if (rc == ESP_OK) rc = nvs_commit(storage);
            if (rc != ESP_OK) return rc;
        } else return loaded;
        ready = true;
        mbedtls_x509_crt test_cert; mbedtls_pk_context test_key;
        mbedtls_x509_crt_init(&test_cert); mbedtls_pk_init(&test_key);
        const int valid = device_identity_load(test_cert, test_key);
        mbedtls_pk_free(&test_key); mbedtls_x509_crt_free(&test_cert);
        if (valid) { ready = false; return ESP_FAIL; }
        return ESP_OK;
    };
    const auto result = run();
    nvs_close(storage); psa_reset_key_attributes(&a);
    if (result != ESP_OK && key_id) { psa_destroy_key(key_id); key_id = 0; }
    return result;
}
