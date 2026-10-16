<div align="center">

# AirBridge

**Un puente experimental de AirDrop para Windows basado en ESP32-S3.**

[English](README.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)](LICENSE) ![ESP-IDF 6.1](https://img.shields.io/badge/ESP--IDF-6.1-334155?style=flat-square) ![C++17](https://img.shields.io/badge/C%2B%2B-17-334155?style=flat-square)

</div>

AirBridge utiliza un ESP32-S3 para Wi-Fi y Bluetooth y lo conecta a Windows mediante un puerto serie. Su núcleo portátil en C++17 implementa las tramas AWDL, la sincronización y el análisis del protocolo; ESP-IDF 6.1 proporciona el backend de radio. La aplicación de escritorio con Tauri 2 está prevista.

> Este README describe las funciones disponibles en este punto del historial. Los resultados de transferencia posteriores no validan esta revisión.

## Estado del proyecto

El núcleo portátil del protocolo está implementado. Esta revisión todavía no ha validado la interoperabilidad de radio ni la transferencia nativa de archivos.

| Función | Estado |
| :--- | :--- |
| Análisis AWDL, relojes y topología | Implementado |
| Aceptación del vecino por Apple | Previsto |
| IPv6 sobre AWDL | Previsto |
| Nombres nativos de dispositivos | Previsto |
| Archivos de Mac → Windows | Previsto |
| Archivos de Windows → Mac | Aún no implementado |
| Aplicación de escritorio | Tauri 2 · React · TypeScript · Rust — prevista |

> Proyecto en desarrollo: siguen sin validarse la visibilidad prolongada, las reconexiones repetidas, los archivos mayores, la interoperabilidad con iPhone, la autenticación de Solo contactos y las carpetas. Detectar una MAC o recibir una confirmación de transmisión no demuestra la entrega de un archivo.

## Hardware y requisitos

| Elemento | Detalles |
| :--- | :--- |
| Plataforma de desarrollo | ESP32-S3 · 16 MiB de flash · 8 MiB de PSRAM octal |
| SDK del firmware | ESP-IDF 6.1 |
| Conexión con Windows | USB Serial/JTAG nativo; un adaptador USB–UART externo es otro transporte aún no validado |
| Dispositivo Apple de validación | Mac con Wi-Fi y Bluetooth activados y AirDrop en Todos |
| Herramientas del equipo | Python con pyserial; herramientas C++ de Visual Studio o CMake para las pruebas del protocolo |

La plataforma de desarrollo incluye PSRAM para futuras transferencias. Esta revisión del escáner no necesita buffers de archivos para recepción.

## Inicio rápido

### 1. Preparar la placa y el SDK

Active un entorno ESP-IDF 6.1, conecte la placa prevista y compruebe su identidad serie. Solo un proceso debe controlar el puerto.

### 2. Compilar el firmware

El firmware predeterminado escucha en el canal 6 y emite observaciones JSON. Utilice primero el escáner para consultar los vecinos AWDL disponibles.

```powershell
idf.py -C firmware -B work/scanner build
```

### 3. Grabar la placa verificada

La grabación sustituye la aplicación activa. Conserve una imagen funcional y compruebe primero la identidad de la placa. El proyecto reserva una aplicación de 2 MiB en `0x10000`, NVS en `0x9000` y datos PHY en `0xf000`; mantenga esta distribución al comparar firmware.

```powershell
idf.py -C firmware -B work/scanner -p COM4 flash
```

En esta revisión, el escáner y las sondas del protocolo son herramientas de desarrollo. Todavía no ofrecen recepción nativa de archivos.

## Verificación

**Comprobaciones del protocolo portátil: 70.**

Las pruebas portátiles cubren tramas malformadas, límites, sincronización y datos del protocolo. Las evidencias de hardware se registran por separado cuando están disponibles.

```powershell
cmd /c scripts\test-native.cmd
```

## Arquitectura

```mermaid
flowchart LR
  Apple["Dispositivo Apple"] <-->|"AWDL · IPv6 · TLS"| ESP["ESP32-S3 / ESP-IDF 6.1"]
  ESP <-->|"Serie"| PC["Equipo Windows"]
  PC -.-> UI["Escritorio Tauri 2 · previsto"]
```

AWDL transporta IPv6, mDNS localiza el servicio AirDrop y TLS transporta las solicitudes de descubrimiento y transferencia. Bluetooth emite un anuncio de activación no conectable. El adaptador Wi-Fi de Windows no necesita inyección AWDL.

La MAC AWDL, la instancia DNS, la etiqueta del host y el nombre de AirDrop son identidades distintas. Los nombres legibles proceden de la respuesta nativa `/Discover`, cuando el dispositivo los proporciona.

## Estructura del repositorio

| Elemento | Detalles |
| :--- | :--- |
| `core/` | Núcleo portátil del protocolo en C++17 |
| `firmware/` | Backend de radio ESP-IDF |
| `scripts/` | Herramientas del equipo y de desarrollo |
| `tests/` | Verificación del protocolo y del equipo |
| `docs/` | Pruebas medidas y notas de referencia |

## Documentación y evidencias

- [Referencias del protocolo](docs/protocol-references.md)

## Próximos pasos

- [ ] Envío independiente de Windows a Apple y transferencias de ida y vuelta verificadas
- [ ] Detección estable, recuperación de conexiones y estados de error claros
- [ ] Selección de más dispositivos, nombres reales y progreso de transferencia
- [ ] Aplicación de escritorio con Tauri 2, React, TypeScript y Rust
- [ ] Ampliación de las pruebas de dispositivos, tamaños de archivo y transportes

## Agradecimientos

La referencia principal para Linux es [t4t5/omdrop-owl](https://github.com/t4t5/omdrop-owl). Su estrategia de canal fijo, selección de sincronización y tratamiento del relleno de recepción orientan los requisitos de interoperabilidad. Gracias también a [OWL](https://github.com/seemoo-lab/owl) y [OpenDrop](https://github.com/seemoo-lab/opendrop) por su investigación sobre AWDL y AirDrop. El uso de las referencias y sus revisiones se documenta en [referencias del protocolo](docs/protocol-references.md); este árbol no incorpora código fuente del protocolo de esos proyectos.

## Licencia

[MIT](LICENSE). AirDrop es tecnología de Apple. AirBridge es un proyecto experimental independiente, sin afiliación ni respaldo de Apple.
