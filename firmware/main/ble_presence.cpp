// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
// Controller-only, nonconnectable wake advertisements. No contact identity claims.
#include "ble_presence.hpp"
#include "esp_bt.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include <array>
#include <algorithm>
#include <cstdio>
#include <cstdint>
namespace {
struct Completion {std::uint16_t opcode;std::uint8_t status;};
QueueHandle_t completions;
void available() {}
int receive(std::uint8_t* bytes,std::uint16_t size) {
    if(!bytes || size<7 || bytes[0]!=4 || bytes[1]!=0x0e || bytes[2]<4 || unsigned(bytes[2])+3>size || !completions) return 0;
    const Completion value{std::uint16_t(unsigned(bytes[4])|unsigned(bytes[5])<<8),bytes[6]};
    if(xPortInIsrContext()) {BaseType_t wake=pdFALSE;xQueueSendFromISR(completions,&value,&wake);if(wake) portYIELD_FROM_ISR();}
    else xQueueSend(completions,&value,0);
    return 0;
}
const esp_vhci_host_callback_t callbacks{available,receive};
esp_err_t command(std::uint16_t opcode,const std::uint8_t* parameters,std::size_t count) {
    if(count>32) return ESP_ERR_INVALID_ARG;
    const auto deadline=esp_timer_get_time()+2'000'000;
    while(!esp_vhci_host_check_send_available()) {if(esp_timer_get_time()>deadline) return ESP_ERR_TIMEOUT;vTaskDelay(pdMS_TO_TICKS(1));}
    std::array<std::uint8_t,36> wire{};wire[0]=1;wire[1]=std::uint8_t(opcode);wire[2]=std::uint8_t(opcode>>8);wire[3]=std::uint8_t(count);
    if(count) std::copy_n(parameters,count,wire.begin()+4);
    esp_vhci_host_send_packet(wire.data(),std::uint16_t(count+4));
    while(esp_timer_get_time()<deadline) {Completion result{};
        if(xQueueReceive(completions,&result,pdMS_TO_TICKS(20))==pdTRUE && result.opcode==opcode) return result.status ? ESP_FAIL : ESP_OK;
    }return ESP_ERR_TIMEOUT;
}
}
esp_err_t ble_presence_begin() {
    completions=xQueueCreate(8,sizeof(Completion));if(!completions) return ESP_ERR_NO_MEM;
    esp_bt_controller_config_t config=BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    auto result=esp_bt_controller_init(&config);if(result!=ESP_OK) return result;
    result=esp_bt_controller_enable(ESP_BT_MODE_BLE);if(result!=ESP_OK) return result;
    result=esp_vhci_host_register_callback(&callbacks);if(result!=ESP_OK) return result;
    result=command(0x0c03,nullptr,0);if(result!=ESP_OK) return result;
    std::array<std::uint8_t,6> random_address{};esp_fill_random(random_address.data(),random_address.size());random_address[5]|=0xc0;
    result=command(0x2005,random_address.data(),random_address.size());if(result!=ESP_OK) return result;
    // 220 ms, ADV_NONCONN_IND, random own address, all three advertising channels.
    const std::array<std::uint8_t,15> parameters{0x60,1,0x60,1,3,1,0,0,0,0,0,0,0,7,0};
    result=command(0x2006,parameters.data(),parameters.size());if(result!=ESP_OK) return result;
    std::array<std::uint8_t,32> payload{};payload[0]=27;
    payload[1]=2;payload[2]=1;payload[3]=6;payload[4]=23;payload[5]=0xff;payload[6]=0x4c;
    payload[8]=5;payload[9]=18;payload[10]=0x40;esp_fill_random(payload.data()+11,3);payload[18]=3;
    result=command(0x2008,payload.data(),payload.size());if(result!=ESP_OK) return result;
    const std::uint8_t enabled=1;result=command(0x200a,&enabled,1);
    std::printf("{\"event\":\"ble_presence_ready\",\"code\":%d,\"contact_authenticated\":false}\n",result);
    return result;
}
esp_err_t ble_presence_refresh() {
    if(!completions) return ESP_ERR_INVALID_STATE;
    const std::uint8_t disabled=0,enabled=1;
    auto result=command(0x200a,&disabled,1);
    if(result!=ESP_OK) return result;
    std::array<std::uint8_t,6> address{};
    esp_fill_random(address.data(),address.size());address[5]|=0xc0;
    result=command(0x2005,address.data(),address.size());
    if(result==ESP_OK) {
        std::array<std::uint8_t,32> payload{};payload[0]=27;
        payload[1]=2;payload[2]=1;payload[3]=6;payload[4]=23;payload[5]=0xff;payload[6]=0x4c;
        payload[8]=5;payload[9]=18;payload[10]=0x40;
        esp_fill_random(payload.data()+11,3);payload[18]=3;
        result=command(0x2008,payload.data(),payload.size());
    }
    const auto resumed=command(0x200a,&enabled,1);
    return result==ESP_OK ? resumed : result;
}
