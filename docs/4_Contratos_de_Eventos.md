---
title: Contratos de Eventos — Microservicio de Inventario
sidebar_label: Contratos de eventos
sidebar_position: 5
slug: /contratos-eventos
---

# Contratos de Eventos — Microservicio de Inventario

**Fuente de verdad del código:** `Inventory-Backend/src/broker/event-conventions.ts` (routing keys, exchanges y payloads tipados), `src/modules/recipe/recipe.events.ts`, `src/modules/reservation/orders.events.ts`, `src/modules/item/item.events.ts`, `src/modules/batch/batch.events.ts` y `src/modules/reservation/reservation.service.ts`.

Este documento describe los contratos de eventos RabbitMQ realmente implementados por Inventario. Si el código y este documento difieren, el código (y los tests E2E) manda.

---

## 0. Convención de nombres (aclaración)

Los requisitos (Etapa 1) definen la convención `Microservicio.Entidad.Accion` en español (p. ej. `Ordenes.Orden.Creada`). La **implementación real** usa:

- Routing keys **en minúsculas, con acciones en inglés y kebab-case**: `inventory.recipe.availability-changed`, `ordenes.order.created`, `menu.source.created`.
- **Alias en español** que Órdenes emite en paralelo (p. ej. `ordenes.orden.creada`). Inventario se suscribe a **ambas variantes** de cada clave, y responde también con ambas.

El formato general es `<microservicio>.<entidad>.<accion>`. Cualquier ajuste al convenio solo toca `event-conventions.ts`.

---

## 1. Topología del broker

Todos los exchanges son **topic** y **durable**. El mensaje es JSON UTF-8 con el payload directamente (no hay sobre-envelope adicional salvo los eventos de Órdenes, que traen su propio envelope — ver §3).

### Exchanges

| Exchange | Publicador | Rol para Inventario | Notas |
|---|---|---|---|
| `menu.topic` | Menú | **Consume** | Registro/sincronización de recetas |
| `ordenes.topic` | Órdenes | **Consume** | Contrato provisional v1 |
| `restaurant.events` | Órdenes / integración | **Consume y publica** | Exchange del contrato de integración con Órdenes & KDS; configurable con `INTEGRATION_EXCHANGE` |
| `inventory.topic` | Inventario | **Publica** (y escucha órdenes por defecto) | Único exchange propio de este microservicio |

Variables de entorno que ajustan la topología:

- `INTEGRATION_EXCHANGE` — nombre del exchange de integración (default `restaurant.events`).
- `ORDERS_EXCHANGES` — lista separada por comas de exchanges donde se escuchan eventos de órdenes (default: `ordenes.topic,restaurant.events`).
- `RABBITMQ_ENABLED=false` — desactiva publisher y consumer (la app funciona sin broker).

### Colas de consumo (una por dominio suscriptor)

| Cola | Consumer | Se suscribe a |
|---|---|---|
| `cola_recipe_events` | `RecipeEvents` | Eventos de menú (`menu.topic`) |
| `cola_item_events` | `ItemEvents` | Eventos de menú (solo loguea por ahora) |
| `cola_batch_events` | `BatchEvents` | Eventos de menú (solo loguea por ahora) |
| `cola_orders_events` | `OrdersEvents` | Eventos de órdenes (durable) en todos los exchanges de órdenes |

---

## 2. Eventos consumidos: Menú

Exchange: `menu.topic`. Payload (`PlateEvent`):

```json
{
  "sourceId": "plate-123",
  "name": "Pasta al pomodoro",
  "sourceType": "plate",
  "items": [
    { "id": "64b0f1c2a1b2c3d4e5f60001", "quantity": 2 }
  ],
  "timestamp": "2026-11-16T18:00:00.000Z"
}
```

Reglas de validación: `sourceId` y `name` obligatorios; `items` debe ser un arreglo con ≥1 elemento y cada `items[n].id` presente con `quantity > 0`. Un payload inválido se ignora (se loguea el motivo).

| Routing key | Efecto en Inventario |
|---|---|
| `menu.source.created` | Registra la receta (`plateId = sourceId`). Si hay insumos inexistentes en el catálogo, se registra igual y se alerta con `inventory.recipe.incomplete` |
| `menu.source.updated` | Upsert idempotente de la receta (si no existía, se crea) |
| `menu.source.deleted` | Elimina la receta (idempotente; si no existe, se ignora) |

---

## 3. Eventos consumidos: Órdenes

Exchanges: todos los de `ORDERS_EXCHANGES` (por defecto `ordenes.topic` **y** `restaurant.events`). Cola: `cola_orders_events` (durable).

Cada evento llega con **dos routing keys equivalentes** (inglés y alias español); Inventario se suscribe a ambas y procesa el evento **una sola vez** (idempotencia por `eventId`, ver más abajo).

### Envelope (contrato provisional v1)

```json
{
  "eventId": "evt-0001",
  "version": 1,
  "occurredAt": "2026-11-16T18:00:00.000Z",
  "correlationId": "corr-abc",
  "orderId": "ord-100",
  "items": [
    { "plateId": "plate-123", "offerId": "offer-77", "quantity": 2 }
  ],
  "reason": "opcional"
}
```

- `eventId` y `orderId` son obligatorios; sin ellos el evento se ignora.
- En cada `items[n]`: `plateId` o `sourceId` (la misma receta) **o** `itemId` directo, con `quantity > 0`. `offerId` es la oferta comercial de Menú (trazabilidad/respuesta).

### Tabla de eventos y efecto

| Acción | Routing key (EN) | Alias (ES) | Efecto en Inventario |
|---|---|---|---|
| Orden creada | `ordenes.order.created` | `ordenes.orden.creada` | Valida disponibilidad y **reserva** stock (no bloquea; publica respuesta de reserva §4.3) |
| Orden confirmada | `ordenes.order.confirmed` | `ordenes.orden.confirmada` | Confirma la reserva existente |
| Orden cancelada | `ordenes.order.cancelled` | `ordenes.orden.cancelada` | **Libera** la reserva |
| Orden servida / en preparación | `ordenes.order.served` | `ordenes.orden.en_preparacion` | **Descuento definitivo** del stock con consumo FEFO y registro de movimientos (punto de no retorno). Soportado por compatibilidad: si no hay reserva activa, se responde rechazado (`ALREADY_SERVED` u otro `errorCode`) |
| Orden expirada | `ordenes.order.expired` | `ordenes.orden.expirada` | Libera reservas huérfanas (`released` o `expired` según el caso) |
| Comanda mermada | `ordenes.order.wasted` | `ordenes.comanda.mermada` | Registra **merma**. Payload específico: usa `itemsAfectados` (o `items`) con `{ plateId \| sourceId \| offerId, quantity }` y `motivo` como razón alternativa |
| Platillo rechazado | `ordenes.dish.rejected` | `ordenes.platillo.rechazado_cocina` | Devuelve el platillo rechazado al stock / registra el ajuste. Requiere `quantity` y al menos un identificador (`plateId`/`sourceId`/`offerId`) |

### Idempotencia

El servicio `ProcessedEventService` guarda los `eventId` ya procesados por consumer: un evento repetido (p. ej. la copia en inglés y español, o un reintentó del broker) se ignora. Si el procesamiento falla, se libera el `eventId` para permitir el reintento.

---

## 4. Eventos publicados por Inventario

Exchange por defecto: `inventory.topic`. Un fallo al publicar **nunca interrumpe la operación de negocio** (se loguea como advertencia).

### 4.1 Disponibilidad de recetas

| Routing key | Cuándo se publica | Payload |
|---|---|---|
| `inventory.recipe.availability-changed` | Cambia la disponibilidad de una receta (receta registrada/actualizada, stock de un insumo cruzó el umbral de "preparable o no") | `{ plateId, isAvailable, timestamp }` |
| `inventory.recipe.not-available` | Una orden no pudo reservarse porque quedaron insumos insuficientes | `{ plateId, name, limitingIngredients: [{ itemId, itemName, requiredQuantity, availableStock }], timestamp }` |
| `inventory.recipe.incomplete` | Receta registrada por evento con insumos inexistentes en el catálogo | `{ plateId, name, missingItemIds: [ ... ], timestamp }` |

### 4.2 Ciclo de vida de reservas (auditoría/observabilidad)

Todas usan el mismo payload (`ReservationResultEvent`):

```json
{
  "orderId": "ord-100",
  "status": "confirmed",
  "eventId": "evt-0001",
  "correlationId": "corr-abc",
  "reason": "motivo opcional (presente en rechazos/liberaciones)",
  "errorCode": "INSUFFICIENT_STOCK",
  "items": [
    { "itemId": "64b0...0001", "itemName": "Tomate", "requestedQuantity": 2, "availableStock": 1 }
  ],
  "timestamp": "2026-11-16T18:00:00.000Z"
}
```

`errorCode` es un código estable y aditivo (p. ej. `RECIPE_NOT_FOUND`, `INSUFFICIENT_STOCK`, `ALREADY_SERVED`).

| Routing key | Significado |
|---|---|
| `inventory.reservation.confirmed` | Reserva confirmada |
| `inventory.reservation.rejected` | Solicitud de reserva rechazada o transición inválida |
| `inventory.reservation.released` | Reserva liberada (cancelación u otra causa) |
| `inventory.reservation.expired` | Reserva liberada por expiración (TTL) |
| `inventory.reservation.consumed` | Reserva consumida: descuento definitivo de stock |

### 4.3 Respuestas de reserva (contrato de integración con Órdenes & KDS)

Se publican **por duplicado a prueba de oyentes**: en `inventory.topic` **y** `restaurant.events`, cada una con la clave en inglés **y** su alias en español (4 publicaciones por respuesta).

**Éxito** — `inventory.stock.reserved` / `inventario.stock.reservado`:

```json
{
  "eventId": "9f8a1c3e-...",
  "orderId": "ord-100",
  "correlationId": "corr-abc",
  "reservations": [
    { "ingredientId": "64b0...0001", "reservedQuantity": 2 }
  ]
}
```

**Falta stock** — `inventory.stock.insufficient` / `inventario.stock.insuficiente`:

```json
{
  "eventId": "9f8a1c3e-...",
  "orderId": "ord-100",
  "correlationId": "corr-abc",
  "reason": "Stock insuficiente para 1 insumo(s)",
  "errorCode": "INSUFFICIENT_STOCK",
  "missingIngredients": ["Tomate"],
  "rejectedItems": [
    { "offerId": "offer-77", "itemName": "Pasta al pomodoro", "requestedQuantity": 2, "availableQuantity": 0 }
  ],
  "reservedItems": [
    { "offerId": "offer-88", "quantity": 1 }
  ]
}
```

Notas:

- `inventory.stock.insufficient` solo se emite para rechazos de una **solicitud de reserva** originada en órdenes; confirmar/cancelar/servir fuera de orden solo produce `inventory.reservation.rejected` (§4.2).
- Los `eventId` de estas respuestas son UUID nuevos generados por Inventario (no reutilizan el `eventId` de la orden); el vínculo se hace con `orderId`/`correlationId`.

---

## 5. Flujo de referencia (ciclo completo de una orden)

```
Órdenes ──ordenes.order.created──▶ Inventario
   Inventario valida disponibilidad por receta (plateId → items de receta)
   ├─ suficiente  ──▶ reserva (stock reservado)
   │     ◀──inventory.stock.reserved / inventario.stock.reservado── (×2 exchanges ×2 claves)
   │     ◀──inventory.reservation.confirmed──────────────────────── (auditoría)
   └─ insuficiente ──▶ sin reserva
         ◀──inventory.stock.insufficient / inventario.stock.insuficiente──
         ◀──inventory.recipe.not-available───────────────────────── (alerta disponibilidad)

Órdenes ──ordenes.orden.en_preparacion / ordenes.order.served──▶ Inventario
   Consumo FEFO del stock reservado + movimientos
         ◀──inventory.reservation.consumed──
         ◀──inventory.recipe.availability-changed── (si cambió la preparabilidad)

Órdenes ──ordenes.order.cancelled / ordenes.order.expired──▶ Inventario
   Liberación de la reserva
         ◀──inventory.reservation.released | inventory.reservation.expired──

Órdenes ──ordenes.comanda.mermada / ordenes.platillo.rechazado_cocina──▶ Inventario
   Registro de merma / devolución
```

---

## 6. Gaps y advertencias conocidas

- El contrato de eventos de Órdenes es **provisional versionado** (`version: 1`); los alias en español existen porque Órdenes emite ambas variantes. Debe revalidarse con el equipo de Órdenes antes de producción.
- El payload de eventos de Menú (`PlateEvent`) es el contrato observado en el integrador; el equipo de Menú no ha publicado un esquema formal.
- `ItemChangeEmitter` (`item.changed`) es un bus de eventos **en proceso** (Node `EventEmitter`), no un evento de RabbitMQ: no forma parte de este contrato.
- `cola_item_events` y `cola_batch_events` hoy solo registran log (preparadas para lógica futura).
