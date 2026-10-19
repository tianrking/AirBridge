<div align="center">

# AirBridge

**[Abrir AirBridge Web ↗](https://w0x7ce.eu/AirBridge/)** · Chrome / Edge de escritorio · [Guía de navegador y permisos](docs/pages.md)

[![CI](https://github.com/tianrking/AirBridge/actions/workflows/ci.yml/badge.svg)](https://github.com/tianrking/AirBridge/actions/workflows/ci.yml)

Cada push y PR ejecuta las pruebas; [las versiones etiquetadas requieren los mismos controles](docs/continuous-delivery.md).

**Un puente experimental de AirDrop para Windows basado en ESP32-S3.**

[English](README.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)](LICENSE) ![ESP-IDF 6.1](https://img.shields.io/badge/ESP--IDF-6.1-334155?style=flat-square) ![C++17](https://img.shields.io/badge/C%2B%2B-17-334155?style=flat-square)

</div>

AirBridge utiliza un ESP32-S3 para Wi-Fi y Bluetooth y lo conecta a Windows mediante un puerto serie. Su núcleo portátil en C++17 implementa las tramas AWDL, la sincronización y el análisis del protocolo; ESP-IDF 6.1 proporciona el backend de radio. La aplicación de escritorio Tauri 2 utiliza React, TypeScript y un único actor serie en Rust.

## Aplicación web

La misma interfaz React/TypeScript admite ahora Web Serial directo. Se conserva
la aplicación Tauri/Rust. En Chrome o Edge de escritorio, ejecuta `npm ci` y
`npm run dev` desde `desktop` y abre **http://127.0.0.1:1420/**. Elige una carpeta
de recepción y después el COM4 verificado. Requiere firmware con `hardware_id`.

Incluye nombres nativos, selección de destinatario, archivos bidireccionales,
progreso y SHA256 de los archivos guardados tras cerrarlos y reabrirlos. Las pruebas
de interfaz, almacenamiento real del navegador y puerto virtual han pasado;
siguen pendientes el puerto real, la carpeta elegida por el usuario y la ida y
vuelta nativa por AirDrop. La evidencia anterior del CLI no valida la ruta web.

[Uso web y almacenamiento](desktop/README.web.md) · [Validación web](docs/web-qualification.md) · [Detalles de interfaz y origen de los datos](docs/product-details.md) · [Recuperación y pruebas automáticas](docs/failure-recovery.md)

## Aplicación de escritorio

Incluye selección de dispositivos, diálogos nativos de archivos y carpetas, progreso bidireccional, cancelación, ubicación de recepción y detalles de transferencia. Inglés por defecto, con español, francés, chino tradicional y árabe en Ajustes. La interfaz web y de escritorio admite los temas Claro, Oscuro y Sistema, con diseño de derecha a izquierda para árabe. [Idiomas y apariencia](docs/localization-and-appearance.md). Los nombres proceden de `/Discover`; los nombres sin resolver se indican explícitamente.

[Compilación y uso](desktop/README.md) · [Estado medido del escritorio](docs/desktop-qualification.md)

## Estado del proyecto

Finder de macOS encontró **AirBridge PC** y entregó un binario de 262.145 bytes con SHA256 coincidente en origen y destino. Tanto el perfil de 6 Mbps como la comparación de anuncios dirigidos a 1 Mbps superaron pruebas acotadas de recepción nativa. El emisor independiente también entregó un binario de 65.537 bytes al Mac y lo recibió de vuelta con el mismo firmware; los SHA256 de las tres copias reales coinciden.

| Función | Estado |
| :--- | :--- |
| Análisis AWDL, relojes y topología | Implementado |
| Aceptación del vecino por Apple | Verificado en hardware |
| IPv6 sobre AWDL | Verificado en hardware |
| Nombres nativos de dispositivos | Verificados mediante TLS `/Discover` |
| Archivos de Mac → Windows | Texto y binario de 262.145 bytes verificados |
| Archivos de Windows → Mac | Binario de 65.537 bytes e ida y vuelta con el mismo firmware verificados |
| Backend Rust | Ida y vuelta nativa de 4.097 bytes verificada sin Python |
| Aplicación de escritorio | Versión de desarrollo; conexión real y nombres nativos comprobados; validación de archivos de escritorio pendiente |

<details>
<summary>Huella del binario verificado</summary>

`AirBridge-native-receive-262145.bin` · 262.145 bytes

```text
eb3ddcc7caeb6bef3d10eacdfc07ce0a89997ae4741711c528cce1402d65596c
```

</details>

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
  -D AIRBRIDGE_RAW_RATE_1M=ON `
  -D "AIRBRIDGE_PROBE_PEER=$peer" build
```

El comando selecciona la velocidad de comparación de 1 Mbps. La prueba registrada también utilizó calibración RF completa; no se ha demostrado que la calibración por sí sola resuelva la detección. El script local `scripts/build-firmware.ps1` admite `-FullCalibration -LegacyRate1M`, pero presupone la distribución del SDK indicada en el propio script.

### 3. Grabar la placa verificada

La grabación sustituye la aplicación activa. Conserve una imagen funcional y compruebe primero la identidad de la placa. El proyecto reserva una aplicación de 2 MiB en `0x10000`, NVS en `0x9000` y datos PHY en `0xf000`; mantenga esta distribución al comparar firmware.

```powershell
idf.py -C firmware -B work/native -p COM4 flash
```

### 4. Iniciar el receptor de Windows

```powershell
python scripts/receive-native.py --directory received/inbox --log work/receive.jsonl --seconds 0
```

Mantenga la CLI abierta. Desbloquee el Mac, active Todos en AirDrop y comparta un archivo desde Finder con **AirBridge PC**. Compare el SHA256 de origen con el recibo y con el archivo real de Windows. Cierre cualquier diálogo antiguo de Waiting antes de reintentar.

Cada bloque serie requiere confirmación. Windows verifica tamaños y SHA256, sincroniza los archivos con el disco y publica el directorio temporal antes de confirmar la transferencia. Los recibos se guardan junto a los directorios completos; los datos `.partial` fallidos se conservan para diagnóstico.

### 5. Enviar desde Windows

Detenga primero cualquier receptor independiente. El emisor controla el mismo
puerto serie y procesa las recepciones mientras espera el consentimiento de Apple.

```powershell
python scripts/send-native.py C:\path\to\file.bin --peer $peer `
  --directory received/inbox --log work/duplex.jsonl --listen-after
```

Acepte la solicitud nativa de AirDrop en el Mac. La CLI distingue la preparación,
el consentimiento, la transmisión del contenedor y la respuesta HTTP nativa, y
obtiene el nombre del dispositivo mediante `/Discover`. El envío inicial admite
un archivo de hasta 1 MiB; el SHA256 del archivo guardado requiere una validación
independiente. Los resultados fallidos o inciertos nunca se reenvían automáticamente.

## Verificación

**Comprobaciones del protocolo portátil: 346.** **Pruebas del host de Windows: 20.**

Las pruebas portátiles cubren tramas malformadas, límites, sincronización y datos del protocolo. Las pruebas del equipo comprueban fallos de desplazamiento, hash y publicación duradera. Las evidencias de hardware se registran por separado.

```powershell
cmd /c scripts\test-native.cmd
```

```powershell
cmake -S . -B build
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
```

```powershell
python -m unittest discover -s tests -p "test_*.py" -q
```

## Arquitectura

```mermaid
flowchart LR
  Apple["Dispositivo Apple"] <-->|"AWDL · IPv6 · TLS"| ESP["ESP32-S3 / ESP-IDF 6.1"]
  ESP <-->|"Serie"| PC["Equipo Windows"]
  PC <--> UI["Tauri 2 · React · TypeScript · Rust"]
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

- [Validación dúplex nativa](docs/native-duplex.md)
- [Protocolo de control serie](docs/serial-protocol.md)
- [Criterios de aceptación del producto](docs/product-acceptance.md)
- [Referencias del protocolo](docs/protocol-references.md)
- [Aceptación de vecinos AWDL](docs/awdl-qualification.md)
- [Intercambio de datos IPv6](docs/ipv6-qualification.md)
- [Nombres nativos mediante Discover](docs/discover-qualification.md)
- [Núcleo de archivos en flujo](docs/transfer-core.md)
- [Recepción nativa y hashes](docs/native-receiving.md)
- [Comparaciones de estabilidad de detección](docs/discovery-stability.md)
- [Recibo de recepción legible por máquinas](docs/native-receive-2026-10-16.json)

## Próximos pasos

- [x] Envío independiente de Windows a Apple e ida y vuelta binaria con el mismo firmware verificados
- [ ] Detección estable, recuperación de conexiones y estados de error claros
- [ ] Selección de más dispositivos, nombres reales y progreso de transferencia
- [x] Versión de desarrollo con Tauri 2, React, TypeScript y Rust
- [ ] Validación dúplex de escritorio empaquetado y detección sostenida
- [ ] Ampliación de las pruebas de dispositivos, tamaños de archivo y transportes

## Agradecimientos

La referencia principal para Linux es [t4t5/omdrop-owl](https://github.com/t4t5/omdrop-owl). Su estrategia de canal fijo, selección de sincronización y tratamiento del relleno de recepción orientan los requisitos de interoperabilidad. Gracias también a [OWL](https://github.com/seemoo-lab/owl) y [OpenDrop](https://github.com/seemoo-lab/opendrop) por su investigación sobre AWDL y AirDrop. El uso de las referencias y sus revisiones se documenta en [referencias del protocolo](docs/protocol-references.md); este árbol no incorpora código fuente del protocolo de esos proyectos.

## Licencia

[MIT](LICENSE). AirDrop es tecnología de Apple. AirBridge es un proyecto experimental independiente, sin afiliación ni respaldo de Apple.
