<div align="center">

# AirBridge

**Un puente experimental de AirDrop para Windows basado en ESP32-S3.**

[English](README.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)](LICENSE) ![ESP-IDF 6.1](https://img.shields.io/badge/ESP--IDF-6.1-334155?style=flat-square) ![C++17](https://img.shields.io/badge/C%2B%2B-17-334155?style=flat-square)

</div>

AirBridge utiliza un ESP32-S3 para Wi-Fi y Bluetooth y lo conecta a Windows mediante un puerto serie. Su núcleo portátil en C++17 implementa las tramas AWDL, la sincronización y el análisis del protocolo; ESP-IDF 6.1 proporciona el backend de radio. La aplicación de escritorio con Tauri 2 está prevista.

> Este README describe las funciones disponibles en este punto del historial. Los resultados de transferencia posteriores no validan esta revisión.

## Estado del proyecto

Finder de macOS encontró **AirBridge PC** y envió a Windows un texto de 22.656 bytes con SHA256 coincidente. Un binario mayor fue rechazado por un salto de desplazamiento serie; la corrección del control de flujo aún necesita validación en hardware.

| Función | Estado |
| :--- | :--- |
| Análisis AWDL, relojes y topología | Implementado |
| Aceptación del vecino por Apple | Verificado en hardware |
| IPv6 sobre AWDL | Verificado en hardware |
| Nombres nativos de dispositivos | Verificados mediante TLS `/Discover` |
| Archivos de Mac → Windows | Texto de 22.656 bytes verificado |
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

El receptor utiliza PSRAM para buffers acotados del archivo contenedor. Las revisiones anteriores de solo escaneo no necesitan esos buffers de recepción.

## Inicio rápido

### 1. Preparar la placa y el SDK

Active un entorno ESP-IDF 6.1, conecte la placa prevista y compruebe su identidad serie. Solo un proceso debe controlar el puerto.

```powershell
python -m pip install -r scripts/requirements.txt
python -m serial.tools.list_ports -v
```

La CLI actual comprueba una placa de desarrollo concreta en **COM4**, incluido su número de serie USB. Revise la asociación en `scripts/receive-native.py` antes de adaptarla a otra placa.

### 2. Compilar el firmware

Sustituya la MAC de ejemplo por la de un dispositivo AWDL de Apple recién observado que anuncie AirDrop. El receptor nativo permite actualmente ese dispositivo configurado de forma explícita.

```powershell
$peer = 'aa:bb:cc:dd:ee:ff'
idf.py -C firmware -B work/native `
  -D AIRBRIDGE_PRESENCE_TX=ON `
  -D AIRBRIDGE_IPV6_LINK=ON `
  -D AIRBRIDGE_NATIVE_SERVICE=ON `
  -D "AIRBRIDGE_PROBE_PEER=$peer" build
```

### 3. Grabar la placa verificada

La grabación sustituye la aplicación activa. Conserve una imagen funcional y compruebe primero la identidad de la placa. El proyecto reserva una aplicación de 2 MiB en `0x10000`, NVS en `0x9000` y datos PHY en `0xf000`; mantenga esta distribución al comparar firmware.

```powershell
idf.py -C firmware -B work/native -p COM4 flash
```

### 4. Iniciar el receptor de Windows

```powershell
python scripts/receive-native.py --directory received/inbox --log work/receive.jsonl --seconds 300
```

Mantenga la CLI abierta. Desbloquee el Mac, active Todos en AirDrop y comparta un archivo desde Finder con **AirBridge PC**. Compare el SHA256 de origen con el recibo y con el archivo real de Windows. Cierre cualquier diálogo antiguo de Waiting antes de reintentar.

Cada bloque serie requiere confirmación. Windows verifica tamaños y SHA256, sincroniza los archivos con el disco y publica el directorio temporal antes de confirmar la transferencia. Los recibos se guardan junto a los directorios completos; los datos `.partial` fallidos se conservan para diagnóstico.

## Verificación

**Comprobaciones del protocolo portátil: 276.** **Pruebas del receptor de Windows: 11.**

Las pruebas portátiles cubren tramas malformadas, límites, sincronización y datos del protocolo. Las pruebas del equipo comprueban fallos de desplazamiento, hash y publicación duradera. Las evidencias de hardware se registran por separado.

```powershell
cmd /c scripts\test-native.cmd
```

```powershell
python -m unittest discover -s tests -p test_receiver.py -q
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
- [Aceptación de vecinos AWDL](docs/awdl-qualification.md)
- [Intercambio de datos IPv6](docs/ipv6-qualification.md)
- [Nombres nativos mediante Discover](docs/discover-qualification.md)
- [Núcleo de archivos en flujo](docs/transfer-core.md)
- [Recepción nativa y hashes](docs/native-receiving.md)

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
