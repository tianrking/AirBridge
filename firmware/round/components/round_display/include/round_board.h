// Board adaptation from the locally verified Spotpear V1 IDF 6.1 bring-up.
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#ifdef __cplusplus
extern "C" {
#endif
esp_err_t round_board_display_init(esp_lcd_panel_io_color_trans_done_cb_t done, void *context);
esp_lcd_panel_handle_t round_board_display_panel(void);
esp_err_t round_board_backlight_set(unsigned percent);
esp_err_t round_board_input_init(void);
esp_err_t round_board_touch_read(uint16_t *x, uint16_t *y, bool *pressed);
bool round_board_button_pressed(void);
#ifdef __cplusplus
}
#endif
