#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_check.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "pins.h"
#include "round_board.h"
static i2c_master_dev_handle_t touch;
bool round_board_button_pressed(void) { return gpio_get_level(BTN_PIN) == 0; }
esp_err_t round_board_input_init(void) {
    gpio_config_t button = {
        .pin_bit_mask = 1ULL << BTN_PIN, .mode = GPIO_MODE_INPUT, .pull_up_en = 1};
    ESP_RETURN_ON_ERROR(gpio_config(&button), "input", "button");
    gpio_config_t reset = {.pin_bit_mask = 1ULL << TOUCH_PIN_NUM_RST, .mode = GPIO_MODE_OUTPUT};
    ESP_RETURN_ON_ERROR(gpio_config(&reset), "input", "reset");
    gpio_set_level(TOUCH_PIN_NUM_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(10));
    gpio_set_level(TOUCH_PIN_NUM_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(120));
    gpio_config_t irq = {
        .pin_bit_mask = 1ULL << TOUCH_PIN_NUM_INT, .mode = GPIO_MODE_INPUT, .pull_up_en = 1};
    ESP_RETURN_ON_ERROR(gpio_config(&irq), "input", "touch interrupt");
    i2c_master_bus_config_t bus = {.i2c_port = I2C_NUM_0,
                                   .sda_io_num = TOUCH_PIN_NUM_I2C_SDA,
                                   .scl_io_num = TOUCH_PIN_NUM_I2C_SCL,
                                   .clk_source = I2C_CLK_SRC_DEFAULT,
                                   .glitch_ignore_cnt = 7,
                                   .flags.enable_internal_pullup = 1};
    i2c_master_bus_handle_t handle;
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus, &handle), "input", "I2C");
    i2c_device_config_t config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7, .device_address = 0x15, .scl_speed_hz = 400000};
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(handle, &config, &touch), "input", "CST816S");
    ESP_RETURN_ON_ERROR(i2c_master_probe(handle, 0x15, 100), "input", "touch not found");
    // Disable automatic sleep so polling remains responsive.
    const uint8_t awake[] = {0xFE, 0x01};
    return i2c_master_transmit(touch, awake, sizeof(awake), 100);
}
esp_err_t round_board_touch_read(uint16_t* x, uint16_t* y, bool* pressed) {
    if (!x || !y || !pressed)
        return ESP_ERR_INVALID_ARG;
    *pressed = false;
    if (!touch)
        return ESP_ERR_INVALID_STATE;
    uint8_t reg = 0x02, data[5];
    esp_err_t err = i2c_master_transmit_receive(touch, &reg, 1, data, sizeof(data), 30);
    if (err != ESP_OK)
        return err;
    *x = ((data[1] & 0x0f) << 8) | data[2];
    *y = ((data[3] & 0x0f) << 8) | data[4];
    *pressed = (data[0] & 0x0f) > 0 && *x < 360 && *y < 360;
    return ESP_OK;
}
