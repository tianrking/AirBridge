// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "awdl.hpp"
#include "esp_err.h"
esp_err_t native_receiver_begin(const airbridge::awdl::Mac& own,const airbridge::awdl::Mac& allowed_peer);
