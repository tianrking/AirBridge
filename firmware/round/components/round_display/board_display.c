#include "round_board.h"
#include "pins.h"
#include "driver/spi_master.h"
#include "driver/ledc.h"
#include "esp_check.h"
#include "esp_lcd_st77916.h"
#include "esp_lcd_custom_types.h"
static esp_lcd_panel_handle_t panel;
esp_lcd_panel_handle_t round_board_display_panel(void)
{
    return panel;
}
esp_err_t round_board_backlight_set(unsigned percent)
{
    if (percent > 100)
        return ESP_ERR_INVALID_ARG;
    ESP_RETURN_ON_ERROR(ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, percent * 8191 / 100),
                        "display", "duty");
    return ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
}
esp_err_t round_board_display_init(esp_lcd_panel_io_color_trans_done_cb_t done, void *context)
{
    ledc_timer_config_t timer = {.speed_mode = LEDC_LOW_SPEED_MODE,
                                 .duty_resolution = LEDC_TIMER_13_BIT,
                                 .timer_num = LEDC_TIMER_0,
                                 .freq_hz = 5000,
                                 .clk_cfg = LEDC_AUTO_CLK};
    ESP_RETURN_ON_ERROR(ledc_timer_config(&timer), "display", "PWM timer");
    ledc_channel_config_t light = {.gpio_num = TFT_BLK,
                                   .speed_mode = LEDC_LOW_SPEED_MODE,
                                   .channel = LEDC_CHANNEL_0,
                                   .timer_sel = LEDC_TIMER_0,
                                   .duty = 0};
    ESP_RETURN_ON_ERROR(ledc_channel_config(&light), "display", "PWM channel");
    spi_bus_config_t bus = ST77916_PANEL_BUS_QSPI_CONFIG(TFT_SCK, TFT_SDA0, TFT_SDA1, TFT_SDA2,
                                                         TFT_SDA3, 360 * 40 * 2);
    ESP_RETURN_ON_ERROR(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO), "display", "QSPI");
    esp_lcd_panel_io_spi_config_t io_config = ST77916_PANEL_IO_QSPI_CONFIG(TFT_CS, done, context);
    esp_lcd_panel_io_handle_t io;
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi(SPI2_HOST, &io_config, &io), "display",
                        "panel IO");
    esp_lcd_panel_vendor_config_t vendor = {.flags.use_qspi_interface = 1};
    esp_lcd_panel_dev_config_t config = {.reset_gpio_num = TFT_RST,
                                         .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
                                         .bits_per_pixel = 16,
                                         .vendor_config = &vendor};
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_st77916(io, &config, &panel), "display", "panel");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(panel), "display", "reset");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(panel), "display", "init");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_invert_color(panel, true), "display", "invert");
    return esp_lcd_panel_disp_on_off(panel, true);
}
