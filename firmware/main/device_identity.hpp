#pragma once
#include "esp_err.h"
#include "mbedtls/pk.h"
#include "mbedtls/x509_crt.h"
// A public firmware image contains no shared private identity. Each device
// provisions its own atomic NVS record on first boot, then reuses it.
esp_err_t device_identity_begin();
int device_identity_load(mbedtls_x509_crt& certificate, mbedtls_pk_context& key);
