---
title: Requisitos — Microservicio de Inventario
sidebar_label: Requisitos
sidebar_position: 1
slug: /requisitos
---

# Documentación de Requisitos — Microservicio de Inventario

**Proyecto escolar — Sistema de restaurante/cocina**
Este documento contiene los Requisitos (Etapa 1), Criterios de Aceptación (Etapa 2), Impacto de Implementación (Etapa 6), la Matriz de Trazabilidad (Etapa 5) y el análisis final del conjunto de requisitos.
Los Casos de Uso (Etapa 3) están en `2_Casos_de_Uso_Inventario.md` y los Test Cases (Etapa 4) en `3_Test_Cases_Inventario.md`.

---

## 0. Contexto y límites del microservicio

- **Alcance:** un único almacén. Control por **lotes** con fecha de caducidad, regla **FEFO** (First Expired, First Out).
- **No se permite stock negativo.**
- Inventario es la **fuente de verdad** de cantidades y stock; gestiona el catálogo de ingredientes, proveedores (con historial de costos) y, a partir de este cambio, también las **recetas de los platillos** (registradas vía evento desde Órdenes/Cocina).
- Comunicación **híbrida**: eventos (reservas, descuentos, registro de recetas, notificaciones proactivas) + síncrona (consulta puntual de disponibilidad).
- **Convención de nombres de eventos:** `Microservicio.Entidad.Accion` (ej. `Ordenes.Orden.Creada`, `Inventario.Reserva.Confirmada`).

**Estados de la orden relevantes para Inventario:**

| Estado orden | Efecto en Inventario |
|---|---|
| Creada | Valida disponibilidad y **reserva** stock |
| En preparación | Stock reservado, reversible |
| Servida | Punto de no retorno → **descuento definitivo** |
| Pagada | No afecta inventario |
| Cancelada | Libera reserva → stock **regresa** a disponible |
| Excepción | Se resuelve como Cancelada (si hay reingreso físico) o como Merma (si no lo hay) |

- **Devoluciones:** solo posibles si la orden **no ha sido servida**. Si ya fue servida, cualquier reingreso se registra como **merma**.
- **Roles:** Almacenista (entradas físicas, conteos) y Administrador (catálogo, proveedores, umbrales).
- **Auditoría:** log simple de movimientos.
- **Novedad de esta versión:** Inventario ahora almacena internamente la **receta** de cada platillo (ingredientes + cantidades), recibida vía evento cuando el platillo se crea en Órdenes/Cocina. Esto permite: (a) que la reserva (RF-01) y la consulta síncrona (RF-05) no dependan de que Órdenes envíe el detalle de ingredientes en cada interacción, y (b) que Inventario pueda **avisar proactivamente** cuando una receta deja de ser preparable por falta de stock (RF-12).
- **Supuesto (SUP-01):** concurrencia resuelta mediante *optimistic locking* (campo `version` en lote) o cola de eventos particionada por SKU/lote.
- **Supuesto (SUP-03):** se asume que el platillo y su receta son gestionados y creados por el microservicio de **Órdenes/Cocina** (mismo servicio del que antes se obtenían las recetas), de ahí el prefijo de evento `Ordenes.Platillo.Creado`. Si el platillo se gestiona en un microservicio distinto (ej. "Menú"), el prefijo del evento debe ajustarse — confirmar con el equipo.

---

## Índice de requisitos

| ID | Nombre | Tipo |
|---|---|---|
| RF-01 | Reserva de inventario al crear una orden | Funcional |
| RF-02 | Descuento definitivo de inventario al servir la orden | Funcional |
| RF-03 | Liberación de reserva por cancelación de orden | Funcional |
| RF-04 | Registro de merma por orden servida sin reingreso | Funcional |
| RF-05 | Validación de disponibilidad de receta (consulta síncrona por platillo) | Funcional |
| RF-06 | Gestión de lotes con fecha de caducidad (FEFO) | Funcional |
| RF-07 | Registro de proveedores e historial de costos | Funcional |
| RF-08 | Ajuste manual de inventario por conteo físico | Funcional |
| RF-09 | Consulta de inventario por otros microservicios | Funcional |
| RF-10 | Configuración de umbrales mínimo/máximo | Funcional |
| **RF-11** | **Registro de receta al crear un platillo (evento)** | **Funcional — nuevo** |
| **RF-12** | **Notificación proactiva de indisponibilidad de receta** | **Funcional — nuevo** |
| RNF-01 | Control de concurrencia sobre stock | No funcional |
| RNF-02 | Auditoría de movimientos de inventario | No funcional |
| RNF-03 | Disponibilidad del servicio | No funcional |

---

## RF-01 — Reserva de inventario al crear una orden *(modificado)*

### 1. Requisito
- **ID:** RF-01
- **Nombre:** Reserva de inventario al crear una orden
- **Descripción:** Cuando el microservicio de Órdenes/Cocina emite el evento `Ordenes.Orden.Creada`, indicando el/los platillo(s) solicitados y sus cantidades, Inventario debe obtener los ingredientes requeridos **consultando su propio registro de recetas** (registrado previamente vía RF-11) y verificar disponibilidad, reservando (apartando) las cantidades necesarias de los lotes correspondientes, aplicando FEFO, sin descontar aún el stock físico total. La reserva debe ser de tipo "todo o nada": si algún ingrediente no tiene stock suficiente, no se reserva ninguno.
- **Prioridad:** Alta
- **Justificación:** Es el punto de entrada del flujo de consumo de inventario. Al depender del registro interno de recetas (y no de datos enviados por Órdenes en cada evento), se reduce el acoplamiento y el riesgo de inconsistencia entre lo que Cocina cree que necesita y lo que Inventario realmente descuenta.

### 2. Criterios de Aceptación
- DADO un platillo con receta registrada (RF-11) y stock suficiente en todos sus ingredientes, CUANDO Inventario recibe `Ordenes.Orden.Creada`, ENTONCES reserva las cantidades usando FEFO y emite `Inventario.Reserva.Confirmada`.
- DADO que al menos un ingrediente de la receta no tiene stock suficiente, CUANDO se recibe `Ordenes.Orden.Creada`, ENTONCES no se reserva ningún ingrediente y se emite `Inventario.Reserva.Rechazada` con el detalle del/los faltante(s).
- DADO un platillo **sin receta registrada** en Inventario (no se recibió o no se procesó `Ordenes.Platillo.Creado`), CUANDO se recibe `Ordenes.Orden.Creada` referenciándolo, ENTONCES Inventario rechaza la reserva con un error específico de "receta no encontrada" (distinto del error de stock insuficiente).
- DADO una reserva confirmada, CUANDO se consulta el stock disponible del ingrediente, ENTONCES la cantidad reservada aparece restada del disponible (no del stock físico total).
- DADO dos eventos `Ordenes.Orden.Creada` simultáneos que compiten por el mismo lote, ENTONCES solo uno debe reservar exitosamente; el otro debe reevaluarse contra el stock actualizado.

### 6. Impacto de Implementación
- **Módulos:** Motor de Reservas, Consultor de Stock (FEFO), Consumidor de eventos `Ordenes.Orden.Creada`, Consultor de Recetas (nuevo, compartido con RF-05/RF-12).
- **Datos requeridos:** `lote(id, sku, cantidad, fecha_vencimiento, version)`, `reserva(id, orden_id, platillo_id, lote_id, cantidad, estado)`, `receta(platillo_id, ingrediente_id, cantidad)`.
- **Entidades afectadas:** Lote, Reserva, Receta, Stock disponible por SKU.
- **API/servicios necesarios:** consumidor de `Ordenes.Orden.Creada`; productor de `Inventario.Reserva.Confirmada` / `Inventario.Reserva.Rechazada`.
- **Riesgos:** condiciones de carrera en reservas concurrentes; eventos duplicados (idempotencia); desincronización si `Ordenes.Platillo.Creado` no llegó antes que la primera orden de ese platillo.
- **Dependencias técnicas:** broker de eventos, locking optimista, **RF-11 debe procesarse antes** de que puedan existir órdenes válidas de un platillo nuevo.

---

## RF-02 — Descuento definitivo de inventario al servir la orden

### 1. Requisito
- **ID:** RF-02
- **Nombre:** Descuento definitivo de inventario al servir la orden
- **Descripción:** Cuando una orden cambia al estado "Servida" (evento `Ordenes.Orden.Servida`), Inventario debe convertir la reserva asociada en un descuento definitivo del stock físico total, eliminando la reserva. Este es un punto de no retorno.
- **Prioridad:** Alta
- **Justificación:** Refleja el consumo real de ingredientes y define el límite a partir del cual cualquier reingreso se trata como merma.

### 2. Criterios de Aceptación
- DADO una orden con reserva activa, CUANDO se recibe `Ordenes.Orden.Servida`, ENTONCES la cantidad reservada se descuenta del stock físico total y la reserva se cierra.
- DADO que la orden fue servida, CUANDO se intenta registrar una devolución de esa orden, ENTONCES el sistema la rechaza y ofrece registrarla como merma.
- DADO el evento `Ordenes.Orden.Servida` duplicado, ENTONCES el descuento no debe aplicarse dos veces (idempotencia).
- DADO que el descuento definitivo deja alguna receta que usa ese ingrediente por debajo del umbral de preparabilidad, ENTONCES se dispara la evaluación de RF-12.

### 6. Impacto de Implementación
- **Módulos:** Motor de Descuento, Cierre de Reservas, Log de Auditoría, disparador hacia RF-12.
- **Datos requeridos:** actualización de `lote.cantidad`, `reserva.estado`, `movimiento(tipo='descuento', orden_id, lote_id, cantidad, fecha)`.
- **Entidades afectadas:** Lote, Reserva, Movimiento de inventario.
- **API/servicios necesarios:** consumidor de `Ordenes.Orden.Servida`.
- **Riesgos:** pérdida de idempotencia si no se controla el id de evento.
- **Dependencias técnicas:** almacenamiento de estado de eventos procesados (idempotencia).

---

## RF-03 — Liberación de reserva por cancelación de orden

### 1. Requisito
- **ID:** RF-03
- **Nombre:** Liberación de reserva por cancelación de orden
- **Descripción:** Cuando una orden se cancela (evento `Ordenes.Orden.Cancelada`) estando en estado "Creada" o "En preparación" (antes de "Servida"), Inventario debe liberar completamente la reserva asociada, devolviendo la cantidad al stock disponible.
- **Prioridad:** Alta
- **Justificación:** Evita que el stock quede apartado indefinidamente por órdenes que no se concretan.

### 2. Criterios de Aceptación
- DADO una orden con reserva activa en estado "Creada" o "En preparación", CUANDO se recibe `Ordenes.Orden.Cancelada`, ENTONCES el stock reservado regresa al disponible y la reserva se cierra como "liberada".
- DADO que la orden ya fue "Servida", CUANDO se recibe `Ordenes.Orden.Cancelada` para esa orden, ENTONCES el sistema la rechaza (no aplica liberación) e indica que debe tratarse como merma.

### 6. Impacto de Implementación
- **Módulos:** Motor de Reservas (liberación), Log de Auditoría.
- **Datos requeridos:** actualización de `reserva.estado`, `lote.cantidad` (disponible).
- **API/servicios necesarios:** consumidor de `Ordenes.Orden.Cancelada`.
- **Riesgos:** condición de carrera si la cancelación llega justo cuando se procesa "Servida".
- **Dependencias técnicas:** locking optimista.

---

## RF-04 — Registro de merma por orden servida sin reingreso

### 1. Requisito
- **ID:** RF-04
- **Nombre:** Registro de merma por consumo no recuperable
- **Descripción:** Cuando corresponde registrar la pérdida de un ingrediente ya descontado del stock (orden servida no recuperable, o excepción sin reingreso físico), el Almacenista debe poder registrar dicha cantidad como **merma**, sin afectar el stock disponible (ya descontado), pero reflejada en el log para control de costos.
- **Prioridad:** Media
- **Justificación:** Diferencia contablemente devoluciones (regresan a stock) de pérdidas (no regresan).

### 2. Criterios de Aceptación
- DADO una orden servida, CUANDO el Almacenista registra una merma asociada, ENTONCES se crea un registro con cantidad, motivo y referencia a la orden, sin modificar el stock disponible.
- DADO un estado de excepción sin reingreso físico confirmado, CUANDO se resuelve, ENTONCES se registra automáticamente como merma.
- DADO un intento de registrar merma sobre una orden no servida, ENTONCES el sistema rechaza la operación.

### 6. Impacto de Implementación
- **Módulos:** Registro de Mermas, Log de Auditoría.
- **Datos requeridos:** `merma(id, orden_id, ingrediente_id, lote_id, cantidad, motivo, fecha, usuario)`.
- **Entidades afectadas:** Merma, Movimiento de inventario.
- **API/servicios necesarios:** endpoint de registro manual + trigger desde resolución de excepciones.
- **Riesgos:** doble registro si excepción y almacenista registran la misma merma.
- **Dependencias técnicas:** ninguna adicional.

---

## RF-05 — Validación de disponibilidad de receta *(modificado)*

### 1. Requisito
- **ID:** RF-05
- **Nombre:** Validación de disponibilidad de receta (consulta síncrona por platillo)
- **Descripción:** Inventario debe exponer una consulta síncrona que, dado el **identificador de un platillo** (`platillo_id`), determine si existe stock disponible suficiente para prepararlo, usando la **receta registrada internamente** (RF-11) en lugar de requerir que el consumidor envíe el detalle completo de ingredientes.
- **Prioridad:** Alta
- **Justificación:** Evita crear órdenes que luego serán rechazadas por falta de stock, y simplifica el contrato con Órdenes (solo necesita enviar el `platillo_id`, no la lista de ingredientes).

### 2. Criterios de Aceptación
- DADO un `platillo_id` con receta registrada y stock suficiente en todos sus ingredientes, CUANDO Órdenes consulta disponibilidad, ENTONCES Inventario responde "disponible: true".
- DADO que algún ingrediente de la receta no tiene stock suficiente, ENTONCES la respuesta indica específicamente cuál(es) ingrediente(s) están limitando.
- DADO un `platillo_id` sin receta registrada en Inventario, ENTONCES la consulta responde con error controlado ("receta no encontrada"), distinto del caso de stock insuficiente.

### 6. Impacto de Implementación
- **Módulos:** API síncrona de Consulta de Disponibilidad, Consultor de Recetas (compartido con RF-01/RF-12).
- **Datos requeridos:** lectura de `receta`, `lote.cantidad`.
- **API/servicios necesarios:** endpoint REST/gRPC síncrono expuesto a Órdenes, que recibe `platillo_id`.
- **Riesgos:** condición de carrera entre consulta y reserva real (el stock puede cambiar entre ambas llamadas) — comportamiento esperado, no un bug.
- **Dependencias técnicas:** RF-11 debe haber procesado la receta del platillo antes de que esta consulta pueda responder correctamente.

---

## RF-06 — Gestión de lotes con fecha de caducidad (FEFO)

### 1. Requisito
- **ID:** RF-06
- **Nombre:** Gestión de lotes con fecha de caducidad y regla FEFO
- **Descripción:** El sistema debe permitir registrar el ingreso de ingredientes organizados por lotes, cada uno con su fecha de caducidad. Toda operación de descuento o reserva debe seleccionar automáticamente el lote con la fecha de caducidad más próxima (FEFO).
- **Prioridad:** Alta
- **Justificación:** Regla de negocio explícita para minimizar desperdicio por vencimiento.

### 2. Criterios de Aceptación
- DADO múltiples lotes de un mismo ingrediente con distintas fechas de vencimiento, CUANDO se realiza una reserva o descuento, ENTONCES se consume primero el lote más próximo a vencer.
- DADO que el lote seleccionado no cubre la cantidad completa requerida, ENTONCES el sistema continúa tomando del siguiente lote hasta completar la cantidad.
- DADO un lote vencido, ENTONCES no debe considerarse disponible para reserva.

### 6. Impacto de Implementación
- **Módulos:** Motor FEFO, Gestión de Lotes.
- **Datos requeridos:** `lote(id, ingrediente_id, cantidad, fecha_vencimiento, fecha_ingreso, estado)`.
- **API/servicios necesarios:** endpoints CRUD de lotes; proceso interno de selección FEFO.
- **Riesgos:** job necesario para marcar lotes vencidos automáticamente.
- **Dependencias técnicas:** scheduler para revisión de vencimientos; **dispara evaluación de RF-12** si un lote vence y reduce disponibilidad de alguna receta.

---

## RF-07 — Registro de proveedores e historial de costos

### 1. Requisito
- **ID:** RF-07
- **Nombre:** Registro de proveedores y su historial de costos
- **Descripción:** El sistema debe permitir al Administrador registrar proveedores y asociar a cada ingreso de lote el proveedor y costo de compra, manteniendo un historial consultable.
- **Prioridad:** Media
- **Justificación:** Permite comparar costos entre proveedores y analizar variación de precios.

### 2. Criterios de Aceptación
- DADO un proveedor nuevo, CUANDO el Administrador lo registra, ENTONCES queda disponible para asociarse a ingresos de lotes.
- DADO el registro de un ingreso de lote con proveedor y costo, ENTONCES ese costo queda almacenado en el historial.
- DADO un proveedor con historial, CUANDO se consulta, ENTONCES se listan los costos ordenados cronológicamente.

### 6. Impacto de Implementación
- **Módulos:** Gestión de Proveedores, Historial de Costos.
- **Datos requeridos:** `proveedor(id, nombre, contacto)`, `costo_historico(id, proveedor_id, ingrediente_id, costo, fecha, lote_id)`.
- **API/servicios necesarios:** CRUD de proveedores; endpoint de consulta de historial.
- **Riesgos:** ninguno crítico.
- **Dependencias técnicas:** ninguna adicional.

---

## RF-08 — Ajuste manual de inventario por conteo físico

### 1. Requisito
- **ID:** RF-08
- **Nombre:** Ajuste manual de inventario por conteo físico
- **Descripción:** El sistema debe permitir al Almacenista registrar entradas y ajustes de stock basados en la existencia física real, independiente del descuento automático de órdenes. Requiere validación humana explícita.
- **Prioridad:** Alta
- **Justificación:** Las entradas y discrepancias con la realidad física solo pueden confirmarse mediante intervención humana.

### 2. Criterios de Aceptación
- DADO que el Almacenista recibe mercancía física, CUANDO la registra (ingrediente, lote, cantidad, caducidad, proveedor), ENTONCES el stock disponible y físico se incrementan.
- DADO una discrepancia en conteo físico, CUANDO el Almacenista registra el ajuste, ENTONCES el stock se corrige y se registra el motivo.
- DADO un ajuste negativo que dejaría el stock por debajo de cero, ENTONCES el sistema rechaza el ajuste.
- DADO un ajuste negativo que reduce la disponibilidad de alguna receta, ENTONCES se dispara la evaluación de RF-12.

### 6. Impacto de Implementación
- **Módulos:** Gestión de Ajustes Manuales, Gestión de Lotes.
- **Datos requeridos:** `movimiento(tipo='ajuste', ingrediente_id, lote_id, cantidad, motivo, usuario, fecha)`.
- **Entidades afectadas:** Lote, Movimiento de inventario.
- **API/servicios necesarios:** endpoint de registro de ajustes/ingresos (rol Almacenista).
- **Riesgos:** uso indebido para "maquillar" discrepancias sin control de auditoría (ver RNF-02).
- **Dependencias técnicas:** control de roles/permisos.

---

## RF-09 — Consulta de inventario por otros microservicios

### 1. Requisito
- **ID:** RF-09
- **Nombre:** Consulta de inventario por otros microservicios (solo lectura)
- **Descripción:** El sistema debe exponer una API de solo lectura que permita a otros microservicios consultar el stock disponible, el catálogo y su estado, sin capacidad de modificar datos.
- **Prioridad:** Media
- **Justificación:** Otros servicios requieren visibilidad del inventario sin duplicar lógica de negocio.

### 2. Criterios de Aceptación
- DADO un microservicio externo autorizado, CUANDO consulta el stock de un ingrediente, ENTONCES recibe la cantidad disponible y su estado.
- DADO un microservicio no autorizado, ENTONCES la solicitud es rechazada (403).
- DADO cualquier intento de escritura desde esta API, ENTONCES el sistema lo rechaza.

### 6. Impacto de Implementación
- **Módulos:** API pública de solo lectura.
- **Datos requeridos:** lectura de `ingrediente`, `lote` (agregados).
- **API/servicios necesarios:** endpoint REST versionado, autenticación entre servicios.
- **Riesgos:** exposición indebida de datos de costos.
- **Dependencias técnicas:** mecanismo de autenticación/autorización entre microservicios.

---

## RF-10 — Configuración de umbrales mínimo/máximo

### 1. Requisito
- **ID:** RF-10
- **Nombre:** Configuración de umbrales mínimo/máximo de stock
- **Descripción:** El sistema debe permitir al Administrador definir, al crear un ingrediente, un umbral mínimo y máximo de stock, editables posteriormente. Cuando el stock disponible caiga por debajo del mínimo, se debe generar una alerta.
- **Prioridad:** Media
- **Justificación:** Permite anticipar quiebres de stock.

### 2. Criterios de Aceptación
- DADO la creación de un ingrediente, CUANDO se definen umbrales, ENTONCES quedan guardados y editables.
- DADO que el stock cae bajo el umbral mínimo, ENTONCES se genera una alerta.
- DADO un intento de umbral mínimo mayor al máximo, ENTONCES el sistema rechaza la configuración.

### 6. Impacto de Implementación
- **Módulos:** Gestión de Catálogo, Motor de Alertas.
- **Datos requeridos:** `ingrediente(id, nombre, umbral_min, umbral_max)`.
- **API/servicios necesarios:** endpoints CRUD de catálogo; canal de notificación.
- **Riesgos:** ninguno crítico.
- **Dependencias técnicas:** canal de notificación (a definir).

---

## RF-11 — Registro de receta al crear un platillo *(nuevo)*

### 1. Requisito
- **ID:** RF-11
- **Nombre:** Registro de receta al crear un platillo
- **Descripción:** Inventario debe escuchar el evento `Ordenes.Platillo.Creado`, emitido cuando se crea un nuevo platillo en Órdenes/Cocina. El evento contiene el identificador y nombre del platillo, junto con la lista de ingredientes y cantidades que lo componen (la receta). Inventario debe registrar esta receta en su propia base de datos, vinculando cada ingrediente a su SKU correspondiente en su catálogo.
- **Prioridad:** Alta
- **Justificación:** Es la base para que Inventario resuelva de forma autónoma la reserva (RF-01), la consulta síncrona (RF-05) y las notificaciones proactivas (RF-12), sin depender de que Órdenes reenvíe el detalle de ingredientes en cada interacción.

### 2. Criterios de Aceptación
- DADO el evento `Ordenes.Platillo.Creado` con una lista válida de ingredientes existentes en el catálogo, CUANDO Inventario lo recibe, ENTONCES registra la receta (`platillo_id` → ingrediente_id + cantidad) en su base de datos.
- DADO que el evento referencia un ingrediente que no existe en el catálogo de Inventario, ENTONCES el registro de la receta se marca como incompleto y se genera una alerta para revisión (no se descarta silenciosamente).
- DADO un evento `Ordenes.Platillo.Creado` duplicado (mismo `platillo_id`), ENTONCES Inventario no debe duplicar el registro (idempotencia).

### 6. Impacto de Implementación
- **Módulos:** Consumidor de eventos `Ordenes.Platillo.Creado`, Gestión de Recetas.
- **Datos requeridos:** `receta(platillo_id, ingrediente_id, cantidad)`, `platillo(id, nombre, estado)`.
- **Entidades afectadas:** Receta, Platillo (referencia local).
- **API/servicios necesarios:** consumidor de eventos; endpoint interno de consulta de receta (usado por RF-01, RF-05, RF-12).
- **Riesgos:** desincronización si Órdenes crea un platillo con ingredientes que Inventario aún no tiene en catálogo; orden de llegada de eventos (¿puede llegar una orden antes que la receta del platillo, por reintento o desorden del broker?).
- **Dependencias técnicas:** broker de eventos con garantía de entrega; idealmente orden garantizado por `platillo_id` (partición).

---

## RF-12 — Notificación proactiva de indisponibilidad de receta *(nuevo)*

### 1. Requisito
- **ID:** RF-12
- **Nombre:** Notificación proactiva de indisponibilidad de receta
- **Descripción:** Cada vez que el stock disponible de un ingrediente se reduzca (descuento definitivo RF-02, ajuste manual negativo RF-08, o vencimiento de lote RF-06), Inventario debe evaluar las recetas registradas (RF-11) que utilizan ese ingrediente y determinar si continúan siendo preparables con el stock actual. Si una receta que antes era preparable deja de serlo, Inventario debe emitir el evento `Inventario.Receta.NoDisponible`, indicando el platillo afectado y el/los ingrediente(s) limitantes.
- **Prioridad:** Alta
- **Justificación:** Complementa la consulta síncrona (RF-05): evita que Cocina descubra la falta de ingredientes solo al momento de crear la orden, permitiendo reaccionar antes (por ejemplo, ocultando el platillo del menú).

### 2. Criterios de Aceptación
- DADO que el stock de un ingrediente baja por debajo de lo necesario para una receta que antes sí era preparable, CUANDO ocurre la operación que reduce el stock, ENTONCES Inventario emite `Inventario.Receta.NoDisponible` con el platillo y el ingrediente limitante.
- DADO una operación de stock que no afecta ningún ingrediente usado en recetas registradas, ENTONCES no se genera evaluación ni evento (para no generar ruido innecesario).
- DADO que un mismo ingrediente es usado por varias recetas, CUANDO su stock baja, ENTONCES se evalúan **todas** las recetas que lo usan, no solo una.

### 6. Impacto de Implementación
- **Módulos:** Evaluador de Disponibilidad de Recetas (reutiliza la lógica de RF-05), disparado desde RF-02/RF-06/RF-08.
- **Datos requeridos:** lectura de `receta`, `lote.cantidad`; posible tabla `estado_receta(platillo_id, disponible: bool)` para no reevaluar innecesariamente y saber si hubo cambio de estado.
- **Entidades afectadas:** Receta (lectura), Estado de disponibilidad por platillo.
- **API/servicios necesarios:** productor de eventos `Inventario.Receta.NoDisponible`.
- **Riesgos:** ruido excesivo de eventos si no se controla el cambio de estado (emitir solo en la transición disponible→no disponible, no en cada movimiento); costo de recalcular disponibilidad de múltiples recetas por cada movimiento de stock.
- **Dependencias técnicas:** RF-11 (registro de recetas) y RF-05 (lógica de evaluación de disponibilidad) deben existir primero.

---

## Requisitos No Funcionales (RNF)

### RNF-01 — Control de concurrencia sobre el stock
- **ID:** RNF-01
- **Descripción:** El sistema debe garantizar que operaciones concurrentes sobre el mismo lote/ingrediente no generen inconsistencias ni stock negativo, mediante bloqueo optimista o procesamiento serializado por SKU/lote.
- **Prioridad:** Alta
- **Métrica:** 0 casos de stock negativo en pruebas de carga concurrente.
- **Criterio de aceptación:** DADO N solicitudes concurrentes sobre el mismo lote que en conjunto exceden el stock disponible, ENTONCES la suma de operaciones exitosas nunca supera el stock disponible inicial.
- **Supuesto:** SUP-01.

### RNF-02 — Auditoría de movimientos de inventario
- **ID:** RNF-02
- **Descripción:** Todo movimiento que afecte el stock (reserva, descuento, liberación, merma, ajuste manual) debe quedar registrado en un log con tipo, ingrediente/lote, cantidad, usuario/servicio origen y fecha/hora.
- **Prioridad:** Media
- **Métrica:** 100% de los movimientos generan una entrada de log, consultable por ingrediente y rango de fechas.

### RNF-03 — Disponibilidad del servicio
- **ID:** RNF-03
- **Descripción:** El microservicio debe estar operativo durante el horario de operación del restaurante.
- **Prioridad:** Media
- **Métrica propuesta:** disponibilidad ≥ 99% en horario operativo; consulta síncrona (RF-05) ≤ 500 ms percentil 95.

---

## Matriz de Trazabilidad (Etapa 5)

| Requisito | Caso de Uso | Test Cases |
|---|---|---|
| RF-01 | CU-01 | TC-01-01, TC-01-02, TC-01-03, TC-01-04, TC-01-05, TC-01-06 |
| RF-02 | CU-02 | TC-02-01, TC-02-02, TC-02-03, TC-02-04, TC-02-05 |
| RF-03 | CU-03 | TC-03-01, TC-03-02, TC-03-03, TC-03-04 |
| RF-04 | CU-04 | TC-04-01, TC-04-02, TC-04-03, TC-04-04 |
| RF-05 | CU-05 | TC-05-01, TC-05-02, TC-05-03, TC-05-04, TC-05-05 |
| RF-06 | CU-06 | TC-06-01, TC-06-02, TC-06-03, TC-06-04, TC-06-05 |
| RF-07 | CU-07 | TC-07-01, TC-07-02, TC-07-03, TC-07-04, TC-07-05 |
| RF-08 | CU-08 | TC-08-01, TC-08-02, TC-08-03, TC-08-04, TC-08-05 |
| RF-09 | CU-09 | TC-09-01, TC-09-02, TC-09-03, TC-09-04 |
| RF-10 | CU-10 | TC-10-01, TC-10-02, TC-10-03, TC-10-04, TC-10-05 |
| **RF-11** | **CU-11** | **TC-11-01, TC-11-02, TC-11-03, TC-11-04** |
| **RF-12** | **CU-12** | **TC-12-01, TC-12-02, TC-12-03, TC-12-04, TC-12-05** |

---

## Análisis final del conjunto de requisitos

### Requisitos duplicados
No se detectan duplicados. RF-11 (registro de receta) y RF-05 (consulta de disponibilidad) son complementarios, no redundantes: uno alimenta los datos, el otro los consulta.

### Contradicciones detectadas
Ninguna contradicción directa. Se confirma que:
- El registro de receta (RF-11) es un evento **de entrada** distinto del flujo de reserva (RF-01); RF-01 depende de que RF-11 ya haya procesado la receta del platillo.
- El descuento automático (RF-02) y el ajuste manual (RF-08) siguen siendo flujos distintos y complementarios.

### Posibles requisitos faltantes (recomendado evaluar)
1. **Gestión del catálogo de ingredientes** (alta/edición/baja) — sigue sin documentarse como RF propio.
2. **Evento de actualización o eliminación de platillo** (`Ordenes.Platillo.Actualizado`, `Ordenes.Platillo.Eliminado`) — actualmente solo se cubre la creación; si una receta cambia (se agrega/quita un ingrediente), Inventario no tiene forma de enterarse.
3. **Evento de recuperación de disponibilidad** (`Inventario.Receta.Disponible`) — RF-12 cubre el aviso de indisponibilidad, pero no está definido si/cómo se notifica cuando la receta vuelve a ser preparable tras un reabastecimiento (RF-08).
4. **Notificación/alerta al Almacenista o Administrador** por umbral mínimo (RF-10) — canal no definido.
5. **Gestión de excepciones de orden** — falta un RF explícito del flujo operativo (quién y cómo decide si hubo reingreso físico).
6. **Política de expiración de reservas no confirmadas** (mencionada en CU-01 pero no formalizada).
7. **Manejo de eventos fuera de orden**: qué pasa si `Ordenes.Orden.Creada` llega antes que `Ordenes.Platillo.Creado` para el mismo platillo (race condition entre microservicios) — relevante ahora que RF-01 depende de RF-11.

### RNF recomendados adicionales

| Categoría | RNF propuesto |
|---|---|
| Seguridad | Autenticación/autorización por rol; autenticación entre servicios para RF-09. |
| Rendimiento | Consulta de disponibilidad (RF-05) ≤ 500 ms p95; evaluación de RF-12 no debe bloquear el flujo de descuento (RF-02) — idealmente asíncrona. |
| Disponibilidad | Cubierto en RNF-03. |
| Auditoría | Cubierto en RNF-02. |
| Escalabilidad | El registro de recetas (RF-11) y su evaluación (RF-12) deben soportar el crecimiento del catálogo de platillos sin degradar el tiempo de respuesta. |
| Monitoreo | Endpoint de salud (`/health`) y métricas básicas (latencia, tasa de error, eventos no procesados). |
| Mantenibilidad | Cobertura de pruebas automatizadas sobre RF-01, RF-02, RF-06, RF-11, RF-12 (núcleo del negocio). |
| Respaldo y recuperación | Respaldo periódico de la base de datos, incluyendo el nuevo registro de recetas. |
| Accesibilidad | Aplicable solo si el proyecto incluye interfaz gráfica para Almacenista/Administrador. |

---

*Documento generado a partir del levantamiento conversacional de requisitos. Los puntos marcados como "a definir"/"supuesto" deben confirmarse con el equipo antes de pasar a diseño técnico detallado.*
