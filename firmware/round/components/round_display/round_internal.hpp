#pragma once
#include <atomic>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "round_display.hpp"
namespace airbridge::round_display {
extern round_ui::State *shared_state, *ui_snapshot, *diagnostic_snapshot;
extern SemaphoreHandle_t state_mutex;
extern QueueHandle_t actions;
extern Record output;
extern std::atomic<int> requested_view, requested_brightness;
extern std::atomic<unsigned> frames, touch_samples, touch_errors, touches, display_errors;
extern std::atomic<int> touch_x, touch_y;
extern std::atomic<bool> touch_down;
struct Guard {
    Guard() { xSemaphoreTake(state_mutex, portMAX_DELAY); }
    ~Guard() { xSemaphoreGive(state_mutex); }
};
esp_err_t screen_begin();
bool capture_screen();
void set_brightness(unsigned percent);
}  // namespace airbridge::round_display
