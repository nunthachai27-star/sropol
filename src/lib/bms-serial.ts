// Shared helper for minting a fresh primary-key value via BMS's
// `get_serialnumber` function. HOSxP tables that don't auto-generate their
// PK expect the caller to obtain the next serial before POSTing an INSERT.
//
// Payload shape is verified against live BMS — the earlier single-field
// `id_field` shape returned MessageCode 500 "No serial_name". All three
// fields must be present, even though in HOSxP convention they're usually
// identical (`<table>_id`).

import { callFunction } from '@/lib/bms-browser-client';
import type { ConnectionConfig } from '@/types/bms-browser';

export async function mintSerial(
  config: ConnectionConfig,
  table: string,
  idField: string,
): Promise<number> {
  const r = await callFunction<{ Value: number }>('get_serialnumber', config, {
    serial_name: idField,
    table_name: table,
    field_name: idField,
  });
  return Number(r.Value);
}
